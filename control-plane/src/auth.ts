import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { findUser, findBot, getSecurityPolicy } from "./store.js";
import { resolveRoles, isAnyAdmin } from "./rbac.js";
import { ipInCidr } from "./cidr.js";

// DEMO ONLY: a fixed secret and long-ish TTL. Real deployments issue
// short-lived (minutes-hours) certs bound to an SSO identity, not a
// password-derived JWT signed with a static secret.
const JWT_SECRET = process.env.JWT_SECRET ?? "remotely-poc-dev-secret-do-not-use-in-prod";
const TOKEN_TTL = "8h";
// Machine identities get a much shorter TTL than humans by design — the
// "continuously rotated" behavior comes from POST /api/bots/refresh being
// called periodically, not from one long-lived credential. See
// docs/plans/2026-07-29-machine-id-bots.md.
const BOT_TOKEN_TTL = "15m";

export interface TokenPayload {
  sub: string; // username, or "bot:<botId>" for a machine identity
  roles: string[];
  // Absent (undefined) is treated as 0 on both sides of the comparison in
  // verifyTokenLive — a token signed before tokenVersion existed at all
  // still compares correctly against a User row that also predates it.
  tokenVersion?: number;
  // Set only on bot-issued tokens — see verifyTokenLive's bot branch below.
  isBot?: boolean;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

// Bot identity is a separate signing function (own TTL) rather than a
// parameter on signToken, so none of the 4 existing human-login call sites
// need to change at all.
export function signBotToken(botId: string, roles: string[], tokenVersion?: number): string {
  const payload: TokenPayload = { sub: `bot:${botId}`, roles, tokenVersion, isBot: true };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: BOT_TOKEN_TTL });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

// Wraps verifyToken with a live tokenVersion check — a token signed before
// a revocation (password change, or an admin's "log out everywhere") has
// a stale tokenVersion baked in and is rejected here even though its
// signature and expiry are both still otherwise valid. Also re-reads the
// user's live roles in the same lookup, same reasoning requireAuth always
// used: a role grant/revoke must take effect on the very next request, not
// only after a fresh login. Every one of this app's independent
// token-verification call sites (requireAuth here, plus the 8 WS-session
// upgrade handlers in index.ts) goes through this now, not raw
// verifyToken — the same class of gap the tenth-pass fix (stale-JWT-
// trusted-roles) closed at every one of those sites, not just requireAuth.
//
// Bot tokens (isBot: true) branch to the Bot store instead of the User
// store, otherwise identical revocation/live-roles logic — this is the
// ONLY place bot-awareness lives; every call site downstream of this
// function (SSH/RDP/VNC/database/Kubernetes sessions, every admin route)
// gets machine-identity support for free, with zero further changes.
export function verifyTokenLive(token: string): TokenPayload | null {
  const payload = verifyToken(token);
  if (!payload) return null;
  if (payload.isBot) {
    const botId = payload.sub.startsWith("bot:") ? payload.sub.slice(4) : payload.sub;
    const bot = findBot(botId);
    if (!bot) return null;
    if ((payload.tokenVersion ?? 0) !== (bot.tokenVersion ?? 0)) return null;
    return { sub: payload.sub, roles: bot.roles, tokenVersion: bot.tokenVersion, isBot: true };
  }
  const user = findUser(payload.sub);
  if (!user) return null;
  if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) return null;
  return { sub: payload.sub, roles: user.roles, tokenVersion: user.tokenVersion };
}

// Second-factor handoff: password checked out, but MFA is enabled on the
// account, so this token proves "knows the password" without being a real
// session token — it can only be redeemed at /api/login/verify-mfa, and
// only for 5 minutes, so a leaked value from this step is far less useful
// than a leaked real session JWT.
interface MfaPendingPayload {
  sub: string;
  mfaPending: true;
}

export function signMfaPendingToken(username: string): string {
  return jwt.sign({ sub: username, mfaPending: true }, JWT_SECRET, { expiresIn: "5m" });
}

export function verifyMfaPendingToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as MfaPendingPayload;
    return payload.mfaPending ? payload.sub : null;
  } catch {
    return null;
  }
}

export interface AuthedRequest extends Request {
  user?: TokenPayload;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  // verifyTokenLive proves identity AND that the token hasn't been
  // revoked since it was issued, and returns live (not login-time-
  // snapshotted) roles in the same lookup — see its own doc comment.
  const payload = token ? verifyTokenLive(token) : null;
  if (!payload) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.user = payload;
  next();
}

// Empty allowlist = no restriction (today's default, unchanged). A
// non-empty list means req.ip must match at least one entry. Note: req.ip
// is the raw socket address since this app never calls `app.set("trust
// proxy", ...)` anywhere — correct for a direct deployment, but behind a
// real reverse proxy every request would appear to come from the proxy's
// address and this check would need trust-proxy configured first.
function adminIpAllowed(req: Request): boolean {
  const policy = getSecurityPolicy();
  if (policy.adminIpAllowlist.length === 0) return true;
  return policy.adminIpAllowlist.some((cidr) => ipInCidr(req.ip ?? "", cidr));
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user!.roles.includes("admin")) {
    res.status(403).json({ error: "admin only" });
    return;
  }
  if (!adminIpAllowed(req)) {
    res.status(403).json({ error: "admin access is not permitted from this network" });
    return;
  }
  next();
}

// Full admin OR a delegated/tenant admin (non-empty manageLabels on some
// role). Route handlers do their own finer per-entity scoping on top of
// this — it's the floor, not the whole check.
export function requireAnyAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  const roles = resolveRoles(req.user!.roles);
  if (!isAnyAdmin(roles)) {
    res.status(403).json({ error: "admin only" });
    return;
  }
  if (!adminIpAllowed(req)) {
    res.status(403).json({ error: "admin access is not permitted from this network" });
    return;
  }
  next();
}

// File downloads are plain browser navigations (<a href>/window.open),
// which can't attach an Authorization header the way apiFetch does for
// everything else. Rather than fall back to accepting the full session JWT
// via ?token= (an 8h-lived credential landing in server access logs and
// browser history), a caller first exchanges their real session for one of
// these: bound to one exact resourceId+path, valid for 60 seconds. A
// leaked value is useless a minute later and can't be replayed against any
// other file or resource.
interface DownloadTokenPayload {
  sub: string;
  roles: string[];
  resourceId: string;
  path: string;
  downloadOnly: true;
}

export function signDownloadToken(sub: string, roles: string[], resourceId: string, path: string): string {
  return jwt.sign({ sub, roles, resourceId, path, downloadOnly: true }, JWT_SECRET, { expiresIn: "60s" });
}

export function verifyDownloadToken(token: string, resourceId: string, path: string): { sub: string; roles: string[] } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as DownloadTokenPayload;
    if (!payload.downloadOnly || payload.resourceId !== resourceId || payload.path !== path) return null;
    return { sub: payload.sub, roles: payload.roles };
  } catch {
    return null;
  }
}
