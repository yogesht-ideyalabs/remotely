import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { findUser } from "./store.js";
import { resolveRoles, isAnyAdmin } from "./rbac.js";

// DEMO ONLY: a fixed secret and long-ish TTL. Real deployments issue
// short-lived (minutes-hours) certs bound to an SSO identity, not a
// password-derived JWT signed with a static secret.
const JWT_SECRET = process.env.JWT_SECRET ?? "remotely-poc-dev-secret-do-not-use-in-prod";
const TOKEN_TTL = "8h";

export interface TokenPayload {
  sub: string; // username
  roles: string[];
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
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
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  // The JWT proves identity, not current authorization — roles are
  // re-read from the live user record on every request instead of trusting
  // the snapshot baked in at login time. Otherwise a role grant/revoke
  // (e.g. making a role break-glass eligible, then assigning it) silently
  // doesn't take effect for anyone with an already-open session until they
  // log out and back in, which looks exactly like "it didn't work."
  const user = findUser(payload.sub);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.user = { sub: payload.sub, roles: user.roles };
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user!.roles.includes("admin")) {
    res.status(403).json({ error: "admin only" });
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
