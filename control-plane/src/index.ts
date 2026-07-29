import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Client as SSHClient } from "ssh2";
import { createDbClient } from "./dbClients.js";
import { KubeConfig, Exec } from "@kubernetes/client-node";
import { Writable, PassThrough } from "node:stream";
import {
  findUser,
  logAudit,
  readAudit,
  verifyAuditChain,
  listUsers,
  users,
  createUser,
  updateUser,
  bumpTokenVersion,
  deleteUser,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  getRole,
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  deleteConnection,
  assignFolderToUsers,
  listOrganizations,
  createOrganization,
  deleteOrganization,
  getOrganization,
  updateOrganization,
  listSshKeysForUser,
  listAllSshKeys,
  getSshKey,
  createSshKey,
  deleteSshKey,
  publicSshKey,
  getSiemConfig,
  setSiemConfig,
  getSmtpConfig,
  setSmtpConfig,
  getSecurityPolicy,
  setSecurityPolicy,
  getDashboardLayout,
  setDashboardLayout,
  type Role,
  type Connection,
  type ConnectionType,
  type AuditEvent,
  type SmtpConfig,
  type SecurityPolicy,
} from "./store.js";
import {
  listMonitors,
  getMonitor,
  createMonitor,
  updateMonitor,
  deleteMonitor,
  getMonitorChecks,
  computeUptimePercent,
  runMonitorCheck,
  startMonitorScheduler,
  type Monitor,
  type MonitorType,
} from "./monitors.js";
import { sendAlertEmail, sendTestEmail } from "./alertEmail.js";
import { makeRateLimiter } from "./rateLimiter.js";
import { signToken, verifyTokenLive, signMfaPendingToken, verifyMfaPendingToken, signDownloadToken, verifyDownloadToken, signBotToken } from "./auth.js";
import { requireAuth, requireAdmin, requireAnyAdmin, type AuthedRequest } from "./auth.js";
import { generateBase32Secret, verifyTotp, otpauthUrl } from "./totp.js";
import { generateEphemeralKeyPair, issueGrant, checkGrant } from "./sshJit.js";
import { buildAuthorizationUrl, completeLogin } from "./oidc.js";
import { deliverToSiem, initSiemExport } from "./siemExport.js";
import { getComplianceReport } from "./compliance.js";
import { deliverToPlugin, initPluginSystem } from "./pluginSystem.js";
import { listWebhookPlugins, getWebhookPlugin, createWebhookPlugin, updateWebhookPlugin, deleteWebhookPlugin } from "./store.js";
import { getNotificationClearedAt, clearNotificationsFor } from "./store.js";
import {
  getRegistrationOptions,
  verifyRegistration,
  getAuthenticationOptions,
  verifyAuthentication,
} from "./webauthn.js";
import { listWebauthnCredentials, addWebauthnCredential, removeWebauthnCredential, updateWebauthnCounter } from "./store.js";
import {
  createAccessRequest,
  listAccessRequests,
  getAccessRequest,
  approveAccessRequest,
  denyAccessRequest,
  revokeAccessRequest,
  hasActiveGrant,
  hasAnyActiveGrantForResource,
} from "./store.js";
import {
  createJoinToken,
  listJoinTokens,
  revokeJoinToken,
  verifyAgentChallenge,
  registerAgentIdentity,
  consumeJoinToken,
  getAgentIdentity,
  joinTokens,
  listBots,
  createBot,
  updateBotRoles,
  deleteBot,
  findBot,
  bumpBotTokenVersion,
  recordBotJoin,
} from "./store.js";
import {
  canAccessResource,
  loginAllowed,
  effectiveSessionTTLMinutes,
  ipAllowed,
  clipboardAllowed,
  resolveRoles,
  isFullAdmin,
  canManageResource,
  canManageTenant,
  activeRolesEligibleForBreakGlass,
  auditEventInScope,
  isAnyAdmin,
  rolesGrantingAccess,
  getRolesForUser,
} from "./rbac.js";
import {
  agents,
  sessions,
  otherSessions,
  listResources,
  startRecording,
  appendRecording,
  RECORDINGS_DIR,
  addSpectator,
  removeSpectator,
  broadcastToSpectators,
  spectatorCount,
  sendAgentFileRequest,
  resolveAgentFileRequest,
  addDiagramViewer,
  removeDiagramViewer,
  listDiagramViewerNames,
  broadcastToDiagramViewers,
  type SessionInfo,
} from "./state.js";
import { connectToGuacd } from "./guac.js";

const PORT = Number(process.env.PORT ?? 4000);
// DEMO ONLY: a single shared secret every agent uses to join. Real
// deployments use single-use join tokens (or IAM-based joining) so no
// long-lived shared secret exists at all.
const AGENT_JOIN_TOKEN = process.env.AGENT_JOIN_TOKEN ?? "demo-agent-token";
// Version the control plane recommends agents run — compared against each
// agent's self-reported version (already sent at connect time) to flag
// "update available" on the Agent Health page and to know what to hand an
// agent that requests a self-update. Bump this + set AGENT_UPDATE_URL when
// you actually publish a newer compiled agent binary somewhere agents can
// fetch it from.
const AGENT_LATEST_VERSION = process.env.AGENT_LATEST_VERSION ?? "0.1.0";
const AGENT_UPDATE_URL = process.env.AGENT_UPDATE_URL ?? "";
// DEMO ONLY, same caveat as AGENT_JOIN_TOKEN above: a real deployment would
// use per-target mTLS or a network-level trust boundary (this endpoint is
// only ever meant to be reachable from inside the target's own sshd, not
// the public internet) instead of a static shared secret.
const SSH_JIT_INTERNAL_TOKEN = process.env.SSH_JIT_INTERNAL_TOKEN ?? "demo-jit-token";
const SESSION_ID_LEN = 36; // uuid v4 string length, used as a fixed prefix on multiplexed frames
const GUACD_HOST = process.env.GUACD_HOST ?? "localhost";
const GUACD_PORT = Number(process.env.GUACD_PORT ?? 4822);
// Where to send the browser after a successful OIDC login — the control
// plane's own callback URL is what the IdP redirects to, but the actual
// SPA lives on a different origin in dev (Vite on :5173 vs this on :4000).
const WEB_APP_URL = process.env.WEB_APP_URL ?? "http://localhost:5173";

const app = express();
app.use(cors());
// Default 100kb is too small for a profile avatar data: URI — bumped just
// enough for a small image, not so much it opens up a body-size DoS vector.
app.use(express.json({ limit: "2mb" }));

// Hand-rolled rather than pulling in helmet — this is just static header
// values, no protocol surface worth a dependency for. CSP is deliberately
// loose on script-src/style-src (the web app is a Vite SPA served
// separately, this control plane's own responses are JSON, not HTML — the
// header still matters for any browser navigation that ever lands here
// directly, e.g. the OIDC callback redirect). HSTS is included but only
// meaningful once this sits behind real TLS termination — harmless no-op
// over plain HTTP otherwise.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  next();
});

// Unauthenticated on purpose — used by orchestration (docker-compose
// wait-for-healthy, load balancers) before any session exists to check.
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ---------- Login rate limiting ----------
// Keyed by IP+username so a distributed attack across many IPs against one
// account still gets throttled per-account, and one IP hammering many
// usernames still gets throttled per-IP. Note: `req.ip` reflects the
// connecting socket, not a real client IP, unless the reverse proxy in
// front of this in production is configured with Express's `trust proxy`
// and forwards X-Forwarded-For — without that, every request behind a
// proxy shares one IP bucket. The username half of the key still limits
// blind-guessing against one account even in that case.
const loginLimiter = makeRateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5, lockoutMs: 15 * 60 * 1000 });

function loginRateLimitKey(ip: string | undefined, username: string): string {
  return `${ip ?? "unknown"}:${username.toLowerCase()}`;
}

// Spam prevention, not brute-force prevention — a legitimate user can
// still submit plenty of real requests, this just stops a compromised or
// scripted account from flooding the approval queue.
const accessRequestLimiter = makeRateLimiter({ windowMs: 10 * 60 * 1000, maxAttempts: 20, lockoutMs: 10 * 60 * 1000 });

// SIEM/plugin test-send hits an admin-configured, but still arbitrary,
// outbound URL — a mild SSRF-adjacent capability (see the existing
// "operational + minor SSRF-adjacent" comment on the monitors section)
// that shouldn't be freely hammerable even by an admin's own compromised
// session.
const webhookTestLimiter = makeRateLimiter({ windowMs: 5 * 60 * 1000, maxAttempts: 10, lockoutMs: 5 * 60 * 1000 });

// Fires once per lockout transition (not on every subsequent blocked
// attempt) — reuses the exact same sendAlertEmail already used for
// uptime-monitor alerts, to the same admin-configured recipients. Users
// have no stored email address in this app, so this is necessarily a
// "notify the security team" signal, not a "notify the affected user" one.
// sendAlertEmail already no-ops safely ({ok:false}, no throw) when SMTP
// isn't configured — nothing extra to guard here.
function notifyLockout(username: string, ip: string | undefined) {
  sendAlertEmail(
    `Remotely: account locked out — ${username}`,
    `${username} was locked out after too many failed login attempts from ${ip ?? "an unknown address"}. Lockout lasts 15 minutes.`
  ).catch(() => {});
}

// A real baseline, not gold-plated NIST 800-63B (no dictionary check, no
// rotation requirement) — this is the one validation point every password
// set anywhere in the app should route through. Previously only self-
// service change-password checked anything at all (a bare 6-char minimum);
// admin-create-user and admin-update-user had zero validation.
function validatePasswordPolicy(password: unknown): string | null {
  const pw = String(password ?? "");
  if (pw.length < 8) return "password must be at least 8 characters";
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return "password must contain at least one letter and one digit";
  return null;
}

// ---------- REST API: auth ----------

function adminFlags(roleNames: string[]) {
  const roles = resolveRoles(roleNames);
  return {
    isAdmin: isFullAdmin(roles),
    isDelegatedAdmin: roles.some((r) => Object.keys(r.manageLabels).length > 0),
  };
}

// Org-wide "require MFA for admins" is a soft nag, not a hard block —
// hard-blocking risks locking out the only admin account with no recovery
// path. A logged-in-but-unprotected admin session is still strictly safer
// than an admin who can no longer log in at all. The frontend surfaces
// this flag as a banner pointing at Profile -> Security.
function checkMfaSetupRequired(user: { username: string; roles: string[]; mfaEnabled?: boolean }): boolean {
  if (!getSecurityPolicy().requireMfaForAdmins) return false;
  if (!isAnyAdmin(resolveRoles(user.roles))) return false;
  if (user.mfaEnabled) return false;
  return listWebauthnCredentials(user.username).length === 0;
}

app.post("/api/login", (req, res) => {
  const { username, password } = req.body ?? {};
  const rlKey = loginRateLimitKey(req.ip, username ?? "");
  const rl = loginLimiter.check(rlKey);
  if (!rl.allowed) {
    res.setHeader("Retry-After", String(rl.retryAfterSeconds));
    res.status(429).json({ error: `Too many failed login attempts. Try again in ${rl.retryAfterSeconds}s.` });
    return;
  }

  const user = findUser(username ?? "");
  if (!user || !bcrypt.compareSync(password ?? "", user.passwordHash)) {
    const { justLockedOut } = loginLimiter.recordFailure(rlKey);
    if (justLockedOut) notifyLockout(username ?? "unknown", req.ip);
    logAudit(username ?? "unknown", "login_failed", null, "invalid credentials");
    res.status(401).json({ error: "invalid credentials" });
    return;
  }
  loginLimiter.clear(rlKey);
  if (user.mfaEnabled && user.mfaSecret) {
    logAudit(user.username, "login_mfa_pending", null, "password ok, awaiting MFA code");
    res.json({ mfaRequired: true, mfaToken: signMfaPendingToken(user.username) });
    return;
  }
  const token = signToken({ sub: user.username, roles: user.roles, tokenVersion: user.tokenVersion });
  logAudit(user.username, "login", null, `roles=${user.roles.join(",")}`);
  res.json({ token, username: user.username, roles: user.roles, mfaSetupRequired: checkMfaSetupRequired(user), ...adminFlags(user.roles) });
});

app.post("/api/login/verify-mfa", (req, res) => {
  const { mfaToken, code } = req.body ?? {};
  const username = mfaToken ? verifyMfaPendingToken(mfaToken) : null;
  const user = username ? findUser(username) : undefined;
  if (!user || !user.mfaEnabled || !user.mfaSecret) {
    res.status(401).json({ error: "invalid or expired MFA challenge" });
    return;
  }

  // A 6-digit TOTP code is a much smaller search space than a password —
  // same rate limiter, keyed the same way, so this step can't be
  // blind-guessed any more freely than the password step could.
  const rlKey = loginRateLimitKey(req.ip, user.username);
  const rl = loginLimiter.check(rlKey);
  if (!rl.allowed) {
    res.setHeader("Retry-After", String(rl.retryAfterSeconds));
    res.status(429).json({ error: `Too many failed attempts. Try again in ${rl.retryAfterSeconds}s.` });
    return;
  }

  if (!code || !verifyTotp(user.mfaSecret, String(code))) {
    const { justLockedOut } = loginLimiter.recordFailure(rlKey);
    if (justLockedOut) notifyLockout(user.username, req.ip);
    logAudit(user.username, "login_failed", null, "invalid MFA code");
    res.status(401).json({ error: "invalid code" });
    return;
  }
  loginLimiter.clear(rlKey);
  const token = signToken({ sub: user.username, roles: user.roles, tokenVersion: user.tokenVersion });
  logAudit(user.username, "login", null, `roles=${user.roles.join(",")} mfa=true`);
  res.json({ token, username: user.username, roles: user.roles, mfaSetupRequired: checkMfaSetupRequired(user), ...adminFlags(user.roles) });
});

// Real OIDC authorization-code + PKCE flow (see oidc.ts for what's real vs
// stand-in — the protocol code is genuine, the IdP is a self-hosted Dex
// test instance since there's no real corporate tenant to point at here).
app.get("/api/auth/oidc/login", async (_req, res) => {
  try {
    res.redirect(await buildAuthorizationUrl());
  } catch (err) {
    res.status(500).send(`OIDC login unavailable: ${(err as Error).message}`);
  }
});

app.get("/api/auth/oidc/callback", async (req, res) => {
  const code = String(req.query.code ?? "");
  const state = String(req.query.state ?? "");
  if (!code || !state) {
    res.status(400).send("missing code/state");
    return;
  }
  try {
    const claims = await completeLogin(code, state);
    const username = claims.preferred_username || claims.email || claims.sub;
    let user = findUser(username);
    if (!user) {
      // JIT provisioning: identity is vouched for by the IdP, but a new SSO
      // user starts with zero roles/tenant — same "exists but sees nothing
      // until explicitly granted" posture as a manually-created user, so
      // logging in via SSO can never itself be a privilege escalation path.
      user = createUser(username, crypto.randomUUID(), [], "");
      logAudit(username, "sso_user_provisioned", null, `via OIDC sub=${claims.sub}`);
    }
    const token = signToken({ sub: user.username, roles: user.roles, tokenVersion: user.tokenVersion });
    logAudit(user.username, "login", null, `roles=${user.roles.join(",")} via=oidc`);
    const redirect = new URL("/sso-callback", WEB_APP_URL);
    redirect.searchParams.set("token", token);
    res.redirect(redirect.toString());
  } catch (err) {
    console.error("[oidc] callback failed:", err);
    logAudit("unknown", "login_failed", null, `OIDC callback failed: ${(err as Error).message}`);
    res.status(401).send(`SSO login failed: ${(err as Error).message}`);
  }
});

app.get("/api/me", requireAuth, (req: AuthedRequest, res) => {
  const user = findUser(req.user!.sub);
  res.json({
    username: req.user!.sub,
    roles: req.user!.roles,
    mfaSetupRequired: user ? checkMfaSetupRequired(user) : false,
    ...adminFlags(req.user!.roles),
  });
});

// ---------- REST API: profile (self-service — avatar, password, MFA, activity) ----------

app.get("/api/profile", requireAuth, (req: AuthedRequest, res) => {
  const user = findUser(req.user!.sub)!;
  res.json({
    username: user.username,
    tenant: user.tenant,
    roles: user.roles,
    avatar: user.avatar ?? null,
    mfaEnabled: Boolean(user.mfaEnabled),
    passwordlessEnabled: Boolean((user as any).passwordlessEnabled),
    createdAt: user.createdAt,
  });
});

// Toggle passwordless login (per-user)
app.post("/api/profile/passwordless", requireAuth, (req: AuthedRequest, res) => {
  const user = findUser(req.user!.sub);
  if (!user) { res.status(404).json({ error: "user not found" }); return; }
  const { enabled } = req.body;
  // Require at least one passkey registered before enabling
  if (enabled && (!user.webauthnCredentials || user.webauthnCredentials.length === 0)) {
    res.status(400).json({ error: "Register at least one passkey before enabling passwordless login" });
    return;
  }
  (user as any).passwordlessEnabled = Boolean(enabled);
  updateUser(user.username, {});  // trigger save
  logAudit(req.user!.sub, "passwordless_toggled", null, `passwordless=${enabled}`);
  res.json({ passwordlessEnabled: Boolean(enabled) });
});

app.patch("/api/profile/avatar", requireAuth, (req: AuthedRequest, res) => {
  const { avatar } = req.body ?? {};
  if (avatar !== null && (typeof avatar !== "string" || !avatar.startsWith("data:image/"))) {
    res.status(400).json({ error: "avatar must be a data:image/* URI, or null to clear it" });
    return;
  }
  updateUser(req.user!.sub, { avatar });
  res.status(204).end();
});

app.post("/api/profile/change-password", requireAuth, (req: AuthedRequest, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  const user = findUser(req.user!.sub)!;
  if (!currentPassword || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
    res.status(401).json({ error: "current password is incorrect" });
    return;
  }
  const pwError = validatePasswordPolicy(newPassword);
  if (pwError) {
    res.status(400).json({ error: pwError });
    return;
  }
  updateUser(req.user!.sub, { password: newPassword });
  logAudit(req.user!.sub, "password_changed", null, "via profile self-service");
  res.status(204).end();
});

app.get("/api/profile/activity", requireAuth, (req: AuthedRequest, res) => {
  const mine = readAudit(2000).filter((e) => e.username === req.user!.sub);
  res.json(mine.slice(0, 200));
});

// MFA setup is two calls on purpose: /setup generates and returns a secret
// without enabling anything yet, /verify only flips mfaEnabled on once the
// user proves they actually saved it by producing a valid code from it —
// otherwise a user could lock themselves out by enabling MFA for a secret
// they never actually captured in their authenticator app.
app.post("/api/profile/mfa/setup", requireAuth, (req: AuthedRequest, res) => {
  const secret = generateBase32Secret();
  updateUser(req.user!.sub, { mfaSecret: secret, mfaEnabled: false });
  res.json({ secret, otpauthUrl: otpauthUrl(secret, req.user!.sub) });
});

app.post("/api/profile/mfa/verify", requireAuth, (req: AuthedRequest, res) => {
  const user = findUser(req.user!.sub)!;
  const { code } = req.body ?? {};
  if (!user.mfaSecret) {
    res.status(400).json({ error: "call /api/profile/mfa/setup first" });
    return;
  }
  if (!code || !verifyTotp(user.mfaSecret, String(code))) {
    res.status(401).json({ error: "invalid code" });
    return;
  }
  updateUser(req.user!.sub, { mfaEnabled: true });
  logAudit(req.user!.sub, "mfa_enabled", null, "");
  res.status(204).end();
});

// ---------- WebAuthn / passkeys ----------
// Registration (Profile page, while already logged in) and authentication
// (Login page, before a session exists) are separate flows with separate
// endpoints — see webauthn.ts for the actual crypto (via
// @simplewebauthn/server, not hand-rolled).

app.post("/api/profile/webauthn/register-options", requireAuth, async (req: AuthedRequest, res) => {
  try {
    res.json(await getRegistrationOptions(req.user!.sub));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/profile/webauthn/register-verify", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const cred = await verifyRegistration(req.user!.sub, req.body?.response, String(req.body?.deviceName ?? ""));
    addWebauthnCredential(req.user!.sub, cred);
    logAudit(req.user!.sub, "passkey_added", null, `device=${cred.deviceName}`);
    res.status(201).json({ id: cred.id, deviceName: cred.deviceName, createdAt: cred.createdAt });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get("/api/profile/webauthn/credentials", requireAuth, (req: AuthedRequest, res) => {
  res.json(listWebauthnCredentials(req.user!.sub).map((c) => ({ id: c.id, deviceName: c.deviceName, createdAt: c.createdAt })));
});

app.delete("/api/profile/webauthn/credentials/:id", requireAuth, (req: AuthedRequest, res) => {
  const ok = removeWebauthnCredential(req.user!.sub, req.params.id);
  if (!ok) {
    res.status(404).json({ error: "not found" });
    return;
  }
  logAudit(req.user!.sub, "passkey_removed", null, `id=${req.params.id}`);
  res.status(204).end();
});

app.post("/api/login/webauthn/options", async (req, res) => {
  const username = String(req.body?.username ?? "");
  const user = findUser(username);
  if (!user) {
    res.status(404).json({ error: "unknown username" });
    return;
  }
  try {
    res.json(await getAuthenticationOptions(username));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/login/webauthn/verify", async (req, res) => {
  const username = String(req.body?.username ?? "");
  const user = findUser(username);
  if (!user) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }
  try {
    const { credentialId, newCounter } = await verifyAuthentication(username, req.body?.response);
    updateWebauthnCounter(username, credentialId, newCounter);
    const token = signToken({ sub: user.username, roles: user.roles, tokenVersion: user.tokenVersion });
    logAudit(user.username, "login", null, `roles=${user.roles.join(",")} via=passkey`);
    res.json({ token, username: user.username, roles: user.roles, mfaSetupRequired: checkMfaSetupRequired(user), ...adminFlags(user.roles) });
  } catch (err) {
    logAudit(username, "login_failed", null, `passkey auth failed: ${(err as Error).message}`);
    res.status(401).json({ error: (err as Error).message });
  }
});

app.post("/api/profile/mfa/disable", requireAuth, (req: AuthedRequest, res) => {
  const user = findUser(req.user!.sub)!;
  const { currentPassword } = req.body ?? {};
  if (!currentPassword || !bcrypt.compareSync(currentPassword, user.passwordHash)) {
    res.status(401).json({ error: "current password is incorrect" });
    return;
  }
  updateUser(req.user!.sub, { mfaEnabled: false, mfaSecret: null });
  logAudit(req.user!.sub, "mfa_disabled", null, "");
  res.status(204).end();
});


// ---------- REST API: resources ----------

app.get("/api/resources", requireAuth, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const visible = listResources().filter(
    (r) => canAccessResource(roles, r, req.user!.sub) || hasAnyActiveGrantForResource(req.user!.sub, r.id)
  );
  res.json(visible);
});

// ---------- REST API: JIT access requests / approval workflow / break-glass ----------

const BREAK_GLASS_TTL_MINUTES = 60;

app.post("/api/access-requests", requireAuth, (req: AuthedRequest, res) => {
  const rl = accessRequestLimiter.check(req.user!.sub);
  if (!rl.allowed) {
    res.setHeader("Retry-After", String(rl.retryAfterSeconds));
    res.status(429).json({ error: `Too many access requests submitted. Try again in ${rl.retryAfterSeconds}s.` });
    return;
  }
  accessRequestLimiter.recordFailure(req.user!.sub);
  const { resourceId, login, reason, breakGlass } = req.body ?? {};
  if (!resourceId || !login || !reason) {
    res.status(400).json({ error: "resourceId, login, and reason are all required" });
    return;
  }
  if (!listResources().some((r) => r.id === resourceId)) {
    res.status(404).json({ error: "resource not found" });
    return;
  }

  const roles = resolveRoles(req.user!.roles);
  const wantsBreakGlass = Boolean(breakGlass);
  const eligible = wantsBreakGlass && activeRolesEligibleForBreakGlass(roles);
  if (wantsBreakGlass && !eligible) {
    res.status(403).json({ error: "no active role grants break-glass self-approval" });
    return;
  }

  const request = createAccessRequest(req.user!.sub, resourceId, login, String(reason), eligible);
  if (eligible) {
    approveAccessRequest(request.id, req.user!.sub, BREAK_GLASS_TTL_MINUTES);
    logAudit(
      req.user!.sub,
      "access_request_break_glass",
      resourceId,
      `login=${login} requestId=${request.id} expiresInMinutes=${BREAK_GLASS_TTL_MINUTES}`
    );
  } else {
    logAudit(req.user!.sub, "access_request_created", resourceId, `login=${login} requestId=${request.id}`);
    // Notify all configured ChatOps channels (Slack/PagerDuty/Teams/Discord)
    import("./chatOpsIntegrations.js").then(({ notifyAllChatOps }) => {
      notifyAllChatOps({ id: request.id, requestedBy: req.user!.sub, resourceId, login, reason: String(reason), breakGlass: false }).catch(() => {});
    }).catch(() => {});
  }
  res.status(201).json(getAccessRequest(request.id));
});

app.get("/api/my-access-requests", requireAuth, (req: AuthedRequest, res) => {
  const mine = listAccessRequests()
    .filter((r) => r.requestedBy === req.user!.sub)
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json(mine);
});

app.get("/api/admin/access-requests", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const all = listAccessRequests();
  const scoped = isFullAdmin(roles) ? all : all.filter((r) => canManageResource(roles, resourceLabelsFor(r.resourceId)));
  const statusFilter = req.query.status as string | undefined;
  const filtered = statusFilter ? scoped.filter((r) => r.status === statusFilter) : scoped;
  res.json(filtered.sort((a, b) => b.createdAt - a.createdAt));
});

function authorizeAccessRequestManage(req: AuthedRequest, res: express.Response): import("./store.js").AccessRequest | undefined {
  const request = getAccessRequest(req.params.id);
  if (!request) {
    res.status(404).json({ error: "not found" });
    return undefined;
  }
  const roles = resolveRoles(req.user!.roles);
  if (!isFullAdmin(roles) && !canManageResource(roles, resourceLabelsFor(request.resourceId))) {
    res.status(403).json({ error: "resource outside your managed scope" });
    return undefined;
  }
  return request;
}

app.post("/api/admin/access-requests/:id/approve", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const request = authorizeAccessRequestManage(req, res);
  if (!request) return;
  if (request.status !== "pending") {
    res.status(409).json({ error: `request is already ${request.status}` });
    return;
  }
  const ttlMinutes = Number(req.body?.ttlMinutes) > 0 ? Number(req.body.ttlMinutes) : 60;
  const updated = approveAccessRequest(request.id, req.user!.sub, ttlMinutes);
  logAudit(req.user!.sub, "access_request_approved", request.resourceId, `requestId=${request.id} ttlMinutes=${ttlMinutes} requester=${request.requestedBy}`);
  res.json(updated);
});

app.post("/api/admin/access-requests/:id/deny", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const request = authorizeAccessRequestManage(req, res);
  if (!request) return;
  if (request.status !== "pending") {
    res.status(409).json({ error: `request is already ${request.status}` });
    return;
  }
  const reason = String(req.body?.reason ?? "");
  const updated = denyAccessRequest(request.id, req.user!.sub, reason);
  logAudit(req.user!.sub, "access_request_denied", request.resourceId, `requestId=${request.id} requester=${request.requestedBy} reason=${reason}`);
  res.json(updated);
});

app.post("/api/admin/access-requests/:id/revoke", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const request = authorizeAccessRequestManage(req, res);
  if (!request) return;
  if (request.status !== "approved") {
    res.status(409).json({ error: `request is not currently approved (status: ${request.status})` });
    return;
  }
  const updated = revokeAccessRequest(request.id, req.user!.sub);
  logAudit(req.user!.sub, "access_request_revoked", request.resourceId, `requestId=${request.id} requester=${request.requestedBy}`);
  res.json(updated);
});

// Self-service: give up your own still-active grant early. Deliberately
// separate from the admin revoke route above (not just the same handler
// with a looser gate) — this can only ever act on a request the caller
// made themselves, an admin revoke can act on anyone's.
app.post("/api/access-requests/:id/give-up", requireAuth, (req: AuthedRequest, res) => {
  const request = getAccessRequest(req.params.id);
  if (!request || request.requestedBy !== req.user!.sub) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (request.status !== "approved") {
    res.status(409).json({ error: `request is not currently approved (status: ${request.status})` });
    return;
  }
  const updated = revokeAccessRequest(request.id, req.user!.sub);
  logAudit(req.user!.sub, "access_request_revoked", request.resourceId, `requestId=${request.id} self-service`);
  res.json(updated);
});

// ---------- REST API: admin — users ----------

app.get("/api/admin/users", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const all = listUsers();
  res.json(isFullAdmin(roles) ? all : all.filter((u) => canManageTenant(roles, u.tenant)));
});

function rolesGrantEscalation(roleNames: string[]): boolean {
  return roleNames.some((name) => {
    if (name === "admin") return true;
    const role = getRole(name);
    return role ? Object.keys(role.manageLabels).length > 0 : false;
  });
}

app.post("/api/admin/users", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const { username, password, roles: newRoles, tenant } = req.body ?? {};
  if (!username || !password || !Array.isArray(newRoles)) {
    res.status(400).json({ error: "username, password, roles[] required" });
    return;
  }
  const pwError = validatePasswordPolicy(password);
  if (pwError) {
    res.status(400).json({ error: pwError });
    return;
  }
  if (findUser(username)) {
    res.status(409).json({ error: "user already exists" });
    return;
  }
  const targetTenant = String(tenant ?? "");
  if (!isFullAdmin(roles)) {
    if (!canManageTenant(roles, targetTenant)) {
      res.status(403).json({ error: "tenant outside your managed scope" });
      return;
    }
    if (rolesGrantEscalation(newRoles)) {
      res.status(403).json({ error: "cannot grant admin or delegated-admin roles" });
      return;
    }
  }
  const user = createUser(username, password, newRoles, targetTenant);
  logAudit(req.user!.sub, "user_created", null, `username=${username} roles=${newRoles.join(",")} tenant=${targetTenant}`);
  res.status(201).json({ username: user.username, roles: user.roles, tenant: user.tenant, createdAt: user.createdAt });
});

app.patch("/api/admin/users/:username", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const target = findUser(req.params.username);
  if (!target) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (!isFullAdmin(roles)) {
    if (!canManageTenant(roles, target.tenant)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (req.body?.roles && rolesGrantEscalation(req.body.roles)) {
      res.status(403).json({ error: "cannot grant admin or delegated-admin roles" });
      return;
    }
    if (req.body?.tenant !== undefined && !canManageTenant(roles, req.body.tenant)) {
      res.status(403).json({ error: "cannot move user outside your managed scope" });
      return;
    }
  }
  const { roles: bodyRoles, password, tenant } = req.body ?? {};
  if (password) {
    const pwError = validatePasswordPolicy(password);
    if (pwError) {
      res.status(400).json({ error: pwError });
      return;
    }
  }
  const user = updateUser(req.params.username, { roles: bodyRoles, password, tenant });
  logAudit(req.user!.sub, "user_updated", null, `username=${user!.username} roles=${user!.roles.join(",")}`);
  res.json({ username: user!.username, roles: user!.roles, tenant: user!.tenant, createdAt: user!.createdAt });
});

// "Log out everywhere" — revokes every token the target user currently
// holds (via tokenVersion bump, see verifyTokenLive) without touching
// their password. Same tenant-scoping as the other admin user routes.
app.post("/api/admin/users/:username/logout-everywhere", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const target = findUser(req.params.username);
  if (!target) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (!isFullAdmin(roles) && !canManageTenant(roles, target.tenant)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  bumpTokenVersion(req.params.username);
  logAudit(req.user!.sub, "user_logged_out_everywhere", null, `username=${req.params.username}`);
  res.status(204).end();
});

app.delete("/api/admin/users/:username", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const target = findUser(req.params.username);
  if (!target) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (!isFullAdmin(roles) && !canManageTenant(roles, target.tenant)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const remainingAdmins = listUsers().filter((u) => u.username !== target.username && u.roles.includes("admin"));
  if (target.roles.includes("admin") && remainingAdmins.length === 0) {
    res.status(400).json({ error: "cannot delete the last admin user" });
    return;
  }
  deleteUser(req.params.username);
  logAudit(req.user!.sub, "user_deleted", null, `username=${req.params.username}`);
  res.status(204).end();
});

// ---------- REST API: admin — roles (full admin only — delegated admins
// manage users/connections, never the permission model itself) ----------

app.get("/api/admin/roles", requireAuth, requireAdmin, (_req, res) => {
  res.json(listRoles());
});

function roleFromBody(name: string, body: Record<string, unknown>): Role {
  return {
    name,
    description: String(body.description ?? ""),
    category: String(body.category ?? ""),
    allowLabels: (body.allowLabels as Record<string, string[]>) ?? {},
    denyLabels: (body.denyLabels as Record<string, string[]>) ?? {},
    resourceTypes: (body.resourceTypes as string[]) ?? [],
    logins: (body.logins as string[]) ?? [],
    maxSessionTTLMinutes: Number(body.maxSessionTTLMinutes ?? 0),
    allowedCIDRs: (body.allowedCIDRs as string[]) ?? [],
    expiresAt: (body.expiresAt as string) ?? null,
    manageLabels: (body.manageLabels as Record<string, string[]>) ?? {},
    allowClipboard: body.allowClipboard === undefined ? true : Boolean(body.allowClipboard),
    breakGlassEligible: Boolean(body.breakGlassEligible),
  };
}

app.post("/api/admin/roles", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const { name } = req.body ?? {};
  if (!name) {
    res.status(400).json({ error: "name required" });
    return;
  }
  if (getRole(name)) {
    res.status(409).json({ error: "role already exists" });
    return;
  }
  const role = createRole(roleFromBody(name, req.body));
  logAudit(req.user!.sub, "role_created", null, `role=${name}`);
  res.status(201).json(role);
});

app.patch("/api/admin/roles/:name", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const existing = getRole(req.params.name);
  if (!existing) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const merged = roleFromBody(req.params.name, { ...existing, ...req.body });
  const role = updateRole(req.params.name, merged);
  logAudit(req.user!.sub, "role_updated", null, `role=${req.params.name}`);
  res.json(role);
});

app.delete("/api/admin/roles/:name", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  if (req.params.name === "admin") {
    res.status(400).json({ error: "cannot delete the built-in admin role" });
    return;
  }
  const ok = deleteRole(req.params.name);
  if (!ok) {
    res.status(404).json({ error: "not found" });
    return;
  }
  logAudit(req.user!.sub, "role_deleted", null, `role=${req.params.name}`);
  res.status(204).end();
});

// ---------- REST API: admin — connections (Add Connection, folders/tags) ----------

app.get("/api/admin/connections", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const all = listConnections();
  res.json(isFullAdmin(roles) ? all : all.filter((c) => canManageResource(roles, c.labels)));
});

function connectionFromBody(id: string, body: Record<string, unknown>, createdBy: string, createdAt: number): Connection {
  return {
    id,
    hostname: String(body.hostname ?? id),
    type: body.type as ConnectionType,
    labels: (body.labels as Record<string, string>) ?? {},
    folder: String(body.folder ?? ""),
    host: String(body.host ?? ""),
    port: Number(body.port ?? 0),
    username: String(body.username ?? ""),
    password: String(body.password ?? ""),
    databaseName: String(body.databaseName ?? ""),
    assignedUsers: Array.isArray(body.assignedUsers) ? (body.assignedUsers as string[]) : [],
    createdAt,
    createdBy,
    sshKeyId: body.sshKeyId ? String(body.sshKeyId) : undefined,
    sshJitEnabled: Boolean(body.sshJitEnabled),
    kubeconfig: body.kubeconfig ? String(body.kubeconfig) : undefined,
    k8sNamespace: body.k8sNamespace ? String(body.k8sNamespace) : undefined,
    k8sPodName: body.k8sPodName ? String(body.k8sPodName) : undefined,
    k8sContainerName: body.k8sContainerName ? String(body.k8sContainerName) : undefined,
    dbEngine: body.dbEngine === "mysql" ? "mysql" : body.dbEngine === "postgres" ? "postgres" : undefined,
  };
}

app.post("/api/admin/connections", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const labels = (req.body?.labels as Record<string, string>) ?? {};
  if (!isFullAdmin(roles) && !canManageResource(roles, labels)) {
    res.status(403).json({ error: "labels outside your managed scope" });
    return;
  }
  if (!req.body?.hostname || !req.body?.type) {
    res.status(400).json({ error: "hostname and type required" });
    return;
  }
  const id = `conn-${crypto.randomUUID().slice(0, 8)}`;
  const conn = createConnection(connectionFromBody(id, req.body, req.user!.sub, Date.now()));
  logAudit(req.user!.sub, "connection_created", conn.id, `type=${conn.type} hostname=${conn.hostname}`);
  res.status(201).json(conn);
});

app.patch("/api/admin/connections/:id", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const existing = getConnection(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (!isFullAdmin(roles) && !canManageResource(roles, existing.labels)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const merged = connectionFromBody(existing.id, { ...existing, ...req.body }, existing.createdBy, existing.createdAt);
  const conn = updateConnection(existing.id, merged);
  logAudit(req.user!.sub, "connection_updated", existing.id, `type=${conn!.type}`);
  res.json(conn);
});

app.delete("/api/admin/connections/:id", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const existing = getConnection(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (!isFullAdmin(roles) && !canManageResource(roles, existing.labels)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  deleteConnection(req.params.id);
  logAudit(req.user!.sub, "connection_deleted", req.params.id, `hostname=${existing.hostname}`);
  res.status(204).end();
});

// Who can actually reach this Connection right now, and why — powers the
// Diagram Editor/Architecture "Access" panel once a discovered resource has
// been linked to it (see infraRoutes.ts's link-connection endpoint; the two
// systems have no other relationship). Every user is checked against the
// SAME canAccessResource() the real session-authorization path uses, so
// this can't drift from what's actually enforced; rolesGrantingAccess() is
// informational-only on top of that (see its own doc comment in rbac.ts).
app.get("/api/admin/connections/:id/access-summary", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const connection = getConnection(req.params.id);
  if (!connection) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const canAccess = users
    .map((u) => ({ user: u, roles: getRolesForUser(u) }))
    .filter(({ roles, user }) => canAccessResource(roles, connection, user.username))
    .map(({ user, roles }) => ({ username: user.username, viaRoles: rolesGrantingAccess(roles, connection) }));

  const recentDenials = readAudit(2000)
    .filter((e) => e.eventType === "access_denied" && e.resourceId === connection.id)
    .slice(0, 20)
    .map((e) => ({ username: e.username, ts: e.ts, reason: e.details }));

  res.json({ connectionId: connection.id, canAccess, recentDenials });
});

// The reverse direction — every resource a given user can reach right now,
// for the diagram's "blast radius" view (click a user, highlight what they
// can touch). Admin-only: this deliberately lets an admin inspect *anyone's*
// reachable set, not just their own (the existing /api/resources is
// caller-scoped to "your own access").
app.get("/api/admin/users/:username/reachable-resources", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const user = findUser(req.params.username);
  if (!user) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const roles = getRolesForUser(user);
  const resourceIds = listResources()
    .filter((r) => canAccessResource(roles, r, user.username))
    .map((r) => r.id);
  res.json({ username: user.username, resourceIds });
});

// ---------- Internal: JIT SSH authorization callback ----------
// Called by the *target's* sshd (not a browser, not a JWT-holding user) via
// AuthorizedKeysCommand — see control-plane/scripts/setup-ssh-jit.sh for
// the sshd_config + helper script that wires this up. sshd substitutes %u
// (login) and %k (base64 public key blob being offered) into the command
// line; the helper script curls this endpoint and prints whatever it gets
// back verbatim, which is exactly the contract AuthorizedKeysCommand
// expects: zero or more authorized_keys-formatted lines.
app.get("/internal/ssh-authorized-keys", (req, res) => {
  if (req.headers["x-internal-token"] !== SSH_JIT_INTERNAL_TOKEN) {
    res.status(403).end();
    return;
  }
  const login = String(req.query.login ?? "");
  const key = String(req.query.key ?? "");
  res.type("text/plain");
  if (login && key && checkGrant(login, key)) {
    res.send(`ssh-ed25519 ${key} remotely-jit\n`);
  } else {
    res.send("");
  }
});

// ---------- REST API: SSH keys (personal, attachable to ssh-direct connections) ----------

app.get("/api/ssh-keys", requireAuth, (req: AuthedRequest, res) => {
  res.json(listSshKeysForUser(req.user!.sub).map(publicSshKey));
});

// Admin-only: the Connections page needs to offer *any* user's key in its
// "SSH Key" dropdown (an admin is attaching someone else's key to a shared
// connection), not just the admin's own.
app.get("/api/admin/ssh-keys", requireAuth, requireAnyAdmin, (_req: AuthedRequest, res) => {
  res.json(listAllSshKeys().map(publicSshKey));
});

app.post("/api/ssh-keys", requireAuth, (req: AuthedRequest, res) => {
  const { name, privateKey, passphrase } = req.body ?? {};
  if (!name || !privateKey) {
    res.status(400).json({ error: "name and privateKey required" });
    return;
  }
  const key = createSshKey(req.user!.sub, String(name), String(privateKey), passphrase ? String(passphrase) : "");
  logAudit(req.user!.sub, "ssh_key_added", null, `name=${key.name}`);
  res.status(201).json(publicSshKey(key));
});

app.delete("/api/ssh-keys/:id", requireAuth, (req: AuthedRequest, res) => {
  const key = getSshKey(req.params.id);
  if (!key) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const roles = resolveRoles(req.user!.roles);
  if (key.ownerUsername !== req.user!.sub && !isFullAdmin(roles)) {
    res.status(403).json({ error: "not your key" });
    return;
  }
  deleteSshKey(req.params.id);
  logAudit(req.user!.sub, "ssh_key_deleted", null, `name=${key.name}`);
  res.status(204).end();
});

// "Assign this whole folder to these users" — a direct grant (see
// Connection.assignedUsers) applied to every connection sharing that
// folder, so an admin can hand someone a group of connections in one
// click instead of editing each one individually.
app.post("/api/admin/connections/assign-folder", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const { folder, users } = req.body ?? {};
  if (!folder || !Array.isArray(users)) {
    res.status(400).json({ error: "folder and users[] required" });
    return;
  }
  const inScope = listConnections().filter((c) => c.folder === folder);
  if (inScope.length === 0) {
    res.status(404).json({ error: `no connections found in folder "${folder}"` });
    return;
  }
  if (!isFullAdmin(roles) && inScope.some((c) => !canManageResource(roles, c.labels))) {
    res.status(403).json({ error: "folder outside your managed scope" });
    return;
  }
  const unknownUsers = users.filter((u: string) => !findUser(u));
  if (unknownUsers.length > 0) {
    res.status(400).json({ error: `unknown user(s): ${unknownUsers.join(", ")}` });
    return;
  }
  const affected = assignFolderToUsers(folder, users);
  logAudit(req.user!.sub, "folder_assigned", null, `folder=${folder} users=${users.join(",")} connections=${affected.length}`);
  res.json(affected);
});

// ---------- REST API: admin — organizations (full admin only: onboarding
// a new client is a structural/global action, not delegated) ----------

app.get("/api/admin/organizations", requireAuth, requireAdmin, (_req, res) => {
  res.json(listOrganizations());
});

app.post("/api/admin/organizations", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const { id, name } = req.body ?? {};
  if (!id || !name) {
    res.status(400).json({ error: "id and name required" });
    return;
  }
  if (listOrganizations().some((o) => o.id === id)) {
    res.status(409).json({ error: "organization already exists" });
    return;
  }
  const org = createOrganization(id, name);
  logAudit(req.user!.sub, "organization_created", null, `id=${id} name=${name}`);
  res.status(201).json(org);
});

app.patch("/api/admin/organizations/:id", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const { name, brandName, brandColor, logoDataUri } = req.body ?? {};
  const org = updateOrganization(req.params.id, { name, brandName, brandColor, logoDataUri });
  if (!org) {
    res.status(404).json({ error: "not found" });
    return;
  }
  logAudit(req.user!.sub, "organization_updated", null, `id=${org.id}`);
  res.json(org);
});

// Per-tenant usage/SLA metrics — pure aggregation over the audit log +
// existing org/user/connection data, same "nothing new tracked, just
// computed" approach as the Dashboard. session_start/session_end pairs
// (matched by the sessionId embedded in each event's details string) give
// real session-minutes instead of a placeholder number; session_error
// events vs session_start gives a real error rate as the SLA proxy.
app.get("/api/admin/organizations/:id/usage", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const orgId = req.params.id;
  const org = getOrganization(orgId);
  if (!org) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const memberUsernames = new Set(listUsers().filter((u) => u.tenant === orgId).map((u) => u.username));
  const orgConnectionIds = new Set(listConnections().filter((c) => c.labels.client === orgId).map((c) => c.id));
  const events = readAudit(10000).filter(
    (e) => memberUsernames.has(e.username) || (e.resourceId && orgConnectionIds.has(e.resourceId))
  );

  const sessionStarts = events.filter((e) => e.eventType === "session_start");
  const sessionEnds = events.filter((e) => e.eventType === "session_end" || e.eventType === "session_ttl_expired");
  const sessionErrors = events.filter((e) => e.eventType === "session_error");

  const sessionIdOf = (details: string) => /sessionId=([^\s]+)/.exec(details)?.[1];
  const startTsById = new Map<string, number>();
  for (const e of sessionStarts) {
    const id = sessionIdOf(e.details);
    if (id) startTsById.set(id, e.ts);
  }
  let totalMinutes = 0;
  let matchedSessions = 0;
  for (const end of sessionEnds) {
    const id = sessionIdOf(end.details);
    const start = id ? startTsById.get(id) : undefined;
    if (start !== undefined) {
      totalMinutes += Math.max(0, (end.ts - start) / 60_000);
      matchedSessions++;
    }
  }

  res.json({
    org,
    memberCount: memberUsernames.size,
    resourceCount: orgConnectionIds.size,
    sessionsStarted: sessionStarts.length,
    sessionErrors: sessionErrors.length,
    errorRate: sessionStarts.length > 0 ? sessionErrors.length / sessionStarts.length : 0,
    totalSessionMinutes: Math.round(totalMinutes * 10) / 10,
    sessionsWithDuration: matchedSessions,
  });
});

// What the currently logged-in user's own organization looks like,
// branding-wise — used by the topbar to white-label itself per tenant. No
// admin gate: any authenticated user needs this to render their own nav.
app.get("/api/branding", requireAuth, (req: AuthedRequest, res) => {
  const user = findUser(req.user!.sub);
  const org = user?.tenant ? getOrganization(user.tenant) : undefined;
  if (!org || (!org.brandName && !org.brandColor && !org.logoDataUri)) {
    res.json(null);
    return;
  }
  res.json({ brandName: org.brandName ?? null, brandColor: org.brandColor ?? null, logoDataUri: org.logoDataUri ?? null });
});

app.delete("/api/admin/organizations/:id", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const id = req.params.id;
  const affectedUsers = listUsers().filter((u) => u.tenant === id).map((u) => u.username);
  const affectedConnections = listConnections().filter((c) => c.labels.client === id).map((c) => c.id);
  const hasReferences = affectedUsers.length > 0 || affectedConnections.length > 0;
  if (hasReferences && req.query.force !== "true") {
    res.status(409).json({
      error: `${affectedUsers.length} user(s) and ${affectedConnections.length} connection(s) still reference this organization`,
      affectedUsers,
      affectedConnections,
      hint: "retry with ?force=true to delete anyway (they'll keep the org id as a dangling reference, not be deleted themselves)",
    });
    return;
  }
  const ok = deleteOrganization(id);
  if (!ok) {
    res.status(404).json({ error: "not found" });
    return;
  }
  logAudit(
    req.user!.sub,
    "organization_deleted",
    null,
    `id=${id} affectedUsers=${affectedUsers.length} affectedConnections=${affectedConnections.length}`
  );
  res.status(204).end();
});

// ---------- REST API: file transfer (ssh-direct connections only — see
// README for why ssh-agent isn't wired up the same way: it would need a
// new file-operation protocol relayed through the agent's tunnel, not
// just an SFTP subsystem on a connection the control plane already holds) ----------

// Resolves whichever credential a connection actually uses, in priority
// order: ephemeral JIT-granted keypair (sshJitEnabled) > stored SSH key
// (sshKeyId) > plain password. `keyboardAnswer` is still the password even
// for key/JIT-auth connections — some PAM-backed servers fall through to
// keyboard-interactive regardless of what pubkey was offered, so it's the
// only fallback we have in that case, matching the pre-existing behavior.
// The returned `revoke` (JIT mode only) MUST be called once the SSH client
// disconnects — see sshClientFor and the ssh-direct WS handler, both of
// which hook it to the underlying ssh2 Client's "close" event so callers
// can't forget.
function sshAuthConfig(
  conn: Connection
): { host: string; port: number; username: string; password?: string; privateKey?: string; passphrase?: string; revoke?: () => void } {
  const base = { host: conn.host, port: conn.port, username: conn.username };
  if (conn.sshJitEnabled) {
    const { privateKey, keyBlob } = generateEphemeralKeyPair();
    const revoke = issueGrant(conn.username, keyBlob);
    return { ...base, privateKey, revoke };
  }
  if (conn.sshKeyId) {
    const key = getSshKey(conn.sshKeyId);
    if (key) return { ...base, privateKey: key.privateKey, passphrase: key.passphrase || undefined };
  }
  return { ...base, password: conn.password };
}

function sshClientFor(conn: Connection): Promise<SSHClient> {
  return new Promise((resolve, reject) => {
    const client = new SSHClient();
    const { revoke, ...connectOpts } = sshAuthConfig(conn);
    if (revoke) client.on("close", revoke);
    client.on("ready", () => resolve(client));
    client.on("error", reject);
    // Plenty of real SSH servers (anything PAM-backed, which is most cloud
    // VM images) advertise "keyboard-interactive" instead of — or in
    // addition to — "password" auth. Without tryKeyboard + this handler,
    // ssh2 never even attempts the password against those servers and the
    // connection just fails with "all configured authentication methods
    // failed", which looks identical to a genuinely wrong password.
    client.on("keyboard-interactive", (_name, _instructions, _lang, _prompts, finish) => finish([conn.password]));
    client.connect({ ...connectOpts, tryKeyboard: true, readyTimeout: 10000 });
  });
}

app.get("/api/files/:id/list", requireAuth, async (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const auth = authorizeConnectionSession(roles, req.params.id, "ssh-direct", req.user!.sub);
  if (!auth.ok) {
    logAudit(req.user!.sub, "access_denied", req.params.id, auth.reason);
    res.status(403).json({ error: auth.reason });
    return;
  }
  const dirPath = String(req.query.path ?? ".");
  let client: SSHClient | undefined;
  try {
    client = await sshClientFor(auth.conn);
    client.sftp((err, sftp) => {
      if (err || !client) {
        res.status(500).json({ error: err?.message ?? "sftp init failed" });
        client?.end();
        return;
      }
      sftp.readdir(dirPath, (err2, list) => {
        client!.end();
        if (err2) {
          res.status(400).json({ error: err2.message });
          return;
        }
        res.json(
          list.map((entry) => ({
            name: entry.filename,
            size: entry.attrs.size,
            isDirectory: (entry.attrs.mode & 0o170000) === 0o040000, // S_IFDIR
            modifiedAt: entry.attrs.mtime * 1000,
          }))
        );
      });
    });
  } catch (err) {
    logAudit(req.user!.sub, "session_error", req.params.id, `sftp list failed: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/files/:id/download-token", requireAuth, (req: AuthedRequest, res) => {
  const filePath = String(req.body?.path ?? "");
  if (!filePath) {
    res.status(400).json({ error: "path required" });
    return;
  }
  const roles = resolveRoles(req.user!.roles);
  const auth = authorizeConnectionSession(roles, req.params.id, "ssh-direct", req.user!.sub);
  if (!auth.ok) {
    logAudit(req.user!.sub, "access_denied", req.params.id, auth.reason);
    res.status(403).json({ error: auth.reason });
    return;
  }
  res.json({ token: signDownloadToken(req.user!.sub, req.user!.roles, req.params.id, filePath) });
});

app.get("/api/files/:id/download", async (req: AuthedRequest, res) => {
  const filePath = String(req.query.path ?? "");
  if (!filePath) {
    res.status(400).json({ error: "path required" });
    return;
  }
  const dtoken = verifyDownloadToken(String(req.query.dtoken ?? ""), req.params.id, filePath);
  if (!dtoken) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.user = { sub: dtoken.sub, roles: dtoken.roles };
  const roles = resolveRoles(req.user.roles);
  const auth = authorizeConnectionSession(roles, req.params.id, "ssh-direct", req.user.sub);
  if (!auth.ok) {
    logAudit(req.user.sub, "access_denied", req.params.id, auth.reason);
    res.status(403).json({ error: auth.reason });
    return;
  }
  try {
    const client = await sshClientFor(auth.conn);
    client.sftp((err, sftp) => {
      if (err) {
        res.status(500).json({ error: err.message });
        client.end();
        return;
      }
      logAudit(req.user!.sub, "file_download", req.params.id, `path=${filePath}`);
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
      const stream = sftp.createReadStream(filePath);
      stream.on("error", (streamErr: Error) => {
        if (!res.headersSent) res.status(400).json({ error: streamErr.message });
      });
      stream.on("close", () => client.end());
      stream.pipe(res);
    });
  } catch (err) {
    logAudit(req.user!.sub, "session_error", req.params.id, `sftp download failed: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post(
  "/api/files/:id/upload",
  requireAuth,
  express.raw({ limit: "100mb", type: () => true }),
  async (req: AuthedRequest, res) => {
    const roles = resolveRoles(req.user!.roles);
    const auth = authorizeConnectionSession(roles, req.params.id, "ssh-direct", req.user!.sub);
    if (!auth.ok) {
      logAudit(req.user!.sub, "access_denied", req.params.id, auth.reason);
      res.status(403).json({ error: auth.reason });
      return;
    }
    const dirPath = String(req.query.path ?? ".");
    const filename = String(req.query.filename ?? "");
    if (!filename) {
      res.status(400).json({ error: "filename required" });
      return;
    }
    const remotePath = `${dirPath.replace(/\/$/, "")}/${filename}`;
    try {
      const client = await sshClientFor(auth.conn);
      client.sftp((err, sftp) => {
        if (err) {
          res.status(500).json({ error: err.message });
          client.end();
          return;
        }
        const stream = sftp.createWriteStream(remotePath);
        stream.on("error", (streamErr: Error) => {
          client.end();
          if (!res.headersSent) res.status(400).json({ error: streamErr.message });
        });
        stream.on("close", () => {
          client.end();
          logAudit(req.user!.sub, "file_upload", req.params.id, `path=${remotePath} bytes=${req.body.length}`);
          res.status(201).json({ path: remotePath, bytes: req.body.length });
        });
        stream.end(req.body as Buffer);
      });
    } catch (err) {
      logAudit(req.user!.sub, "session_error", req.params.id, `sftp upload failed: ${(err as Error).message}`);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

// ---------- REST API: file transfer (ssh-agent / reverse-tunnel resources —
// see sendAgentFileRequest in state.ts for why this is a separate request/
// response protocol over the existing agent WS tunnel instead of SFTP) ----------

const AGENT_FILE_MAX_BYTES = 20 * 1024 * 1024; // base64-in-JSON, not streamed — keep it modest

function authorizeAgentFile(req: AuthedRequest, res: express.Response): import("./state.js").AgentInfo | undefined {
  const roles = resolveRoles(req.user!.roles);
  const agent = agents.get(req.params.agentId);
  if (!agent || agent.type !== "ssh-agent" || !canAccessResource(roles, agent, req.user!.sub)) {
    logAudit(req.user!.sub, "access_denied", req.params.agentId, "resource not visible under current role");
    res.status(403).json({ error: "resource not visible under current role" });
    return undefined;
  }
  return agent;
}

app.get("/api/agent-files/:agentId/list", requireAuth, async (req: AuthedRequest, res) => {
  const agent = authorizeAgentFile(req, res);
  if (!agent) return;
  const dirPath = String(req.query.path ?? ".");
  try {
    const result = await sendAgentFileRequest(agent, { type: "file-list", path: dirPath });
    if (result.type === "file-list-error") {
      res.status(400).json({ error: result.message });
      return;
    }
    res.json(result.entries);
  } catch (err) {
    logAudit(req.user!.sub, "session_error", req.params.agentId, `agent file list failed: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/agent-files/:agentId/download-token", requireAuth, (req: AuthedRequest, res) => {
  const filePath = String(req.body?.path ?? "");
  if (!filePath) {
    res.status(400).json({ error: "path required" });
    return;
  }
  const agent = authorizeAgentFile(req, res);
  if (!agent) return;
  res.json({ token: signDownloadToken(req.user!.sub, req.user!.roles, req.params.agentId, filePath) });
});

app.get("/api/agent-files/:agentId/download", async (req: AuthedRequest, res) => {
  const filePath = String(req.query.path ?? "");
  if (!filePath) {
    res.status(400).json({ error: "path required" });
    return;
  }
  const dtoken = verifyDownloadToken(String(req.query.dtoken ?? ""), req.params.agentId, filePath);
  if (!dtoken) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.user = { sub: dtoken.sub, roles: dtoken.roles };
  const agent = authorizeAgentFile(req, res);
  if (!agent) return;
  try {
    const result = await sendAgentFileRequest(agent, { type: "file-read", path: filePath, maxBytes: AGENT_FILE_MAX_BYTES });
    if (result.type === "file-read-error") {
      res.status(400).json({ error: result.message });
      return;
    }
    logAudit(req.user!.sub, "file_download", req.params.agentId, `path=${filePath}`);
    const buf = Buffer.from(result.dataBase64 as string, "base64");
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
    res.send(buf);
  } catch (err) {
    logAudit(req.user!.sub, "session_error", req.params.agentId, `agent file download failed: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/agent-files/:agentId/upload", requireAuth, express.raw({ limit: "25mb", type: () => true }), async (req: AuthedRequest, res) => {
  const agent = authorizeAgentFile(req, res);
  if (!agent) return;
  const dirPath = String(req.query.path ?? ".");
  const filename = String(req.query.filename ?? "");
  if (!filename) {
    res.status(400).json({ error: "filename required" });
    return;
  }
  if ((req.body as Buffer).length > AGENT_FILE_MAX_BYTES) {
    res.status(413).json({ error: `file too large — ${AGENT_FILE_MAX_BYTES / 1024 / 1024}MB max for ssh-agent transfer` });
    return;
  }
  const remotePath = `${dirPath.replace(/\/$/, "")}/${filename}`;
  try {
    const result = await sendAgentFileRequest(agent, {
      type: "file-write",
      path: remotePath,
      dataBase64: (req.body as Buffer).toString("base64"),
    });
    if (result.type === "file-write-error") {
      res.status(400).json({ error: result.message });
      return;
    }
    logAudit(req.user!.sub, "file_upload", req.params.agentId, `path=${remotePath} bytes=${(req.body as Buffer).length}`);
    res.status(201).json({ path: remotePath, bytes: (req.body as Buffer).length });
  } catch (err) {
    logAudit(req.user!.sub, "session_error", req.params.agentId, `agent file upload failed: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---------- REST API: admin — agent health ----------

app.get("/api/admin/agents", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const now = Date.now();
  const all = Array.from(agents.values())
    .filter((a) => isFullAdmin(roles) || canManageResource(roles, a.labels))
    .map((a) => ({
      id: a.id,
      hostname: a.hostname,
      labels: a.labels,
      type: a.type,
      version: a.version,
      connectedAt: a.connectedAt,
      uptimeSeconds: Math.floor((now - a.connectedAt) / 1000),
      lastSeenSecondsAgo: Math.floor((now - a.lastSeen) / 1000),
      lastLatencyMs: a.lastLatencyMs,
      activeSessions: Array.from(sessions.values()).filter((s) => s.agentId === a.id).length,
      updateAvailable: a.version !== AGENT_LATEST_VERSION,
      hasIdentity: Boolean(getAgentIdentity(a.id)),
    }));
  res.json(all);
});

app.get("/api/admin/agent-latest-version", requireAuth, requireAnyAdmin, (_req, res) => {
  res.json({ version: AGENT_LATEST_VERSION, updateUrl: AGENT_UPDATE_URL || null });
});

// Nudges a connected agent to self-update — see agent/src/index.ts's
// "update" message handler for what it actually does with this (real
// download+replace when running as the compiled SEA binary, log-only no-op
// under tsx dev mode since there's no single binary file to replace).
app.post("/api/admin/agents/:id/update", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const agent = agents.get(req.params.id);
  if (!agent || (!isFullAdmin(roles) && !canManageResource(roles, agent.labels))) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (!AGENT_UPDATE_URL) {
    res.status(400).json({ error: "AGENT_UPDATE_URL is not configured on the control plane — nothing to download" });
    return;
  }
  agent.socket.send(JSON.stringify({ type: "update", version: AGENT_LATEST_VERSION, downloadUrl: AGENT_UPDATE_URL }));
  logAudit(req.user!.sub, "agent_update_triggered", req.params.id, `targetVersion=${AGENT_LATEST_VERSION}`);
  res.status(204).end();
});

// ---------- REST API: admin — agent join tokens (full admin only, same
// reasoning as organizations: issuing infrastructure-wide bootstrap
// credentials is a structural action, not something to delegate) ----------

app.get("/api/admin/join-tokens", requireAuth, requireAdmin, (_req, res) => {
  res.json(listJoinTokens());
});

app.post("/api/admin/join-tokens", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const { label, maxUses, ttlMinutes } = req.body ?? {};
  const created = createJoinToken(
    req.user!.sub,
    String(label ?? ""),
    Number(maxUses) > 0 ? Number(maxUses) : 1,
    Number(ttlMinutes) > 0 ? Number(ttlMinutes) : 60
  );
  logAudit(req.user!.sub, "join_token_created", null, `label="${created.label}" maxUses=${created.maxUses} ttlMinutes=${ttlMinutes ?? 60}`);
  res.status(201).json(created);
});

app.delete("/api/admin/join-tokens/:token", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const ok = revokeJoinToken(req.params.token);
  if (!ok) {
    res.status(404).json({ error: "not found" });
    return;
  }
  logAudit(req.user!.sub, "join_token_revoked", null, "");
  res.status(204).end();
});

// ---------- REST API: Bots (machine identity — full admin only, same
// reasoning as agent join tokens: issuing bootstrap credentials is a
// structural action). See docs/plans/2026-07-29-machine-id-bots.md. ----------

app.get("/api/admin/bots", requireAuth, requireAdmin, (_req, res) => {
  res.json(listBots());
});

app.post("/api/admin/bots", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const { id, roles } = req.body ?? {};
  const botId = String(id ?? "").trim();
  if (!botId) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  if (findBot(botId)) {
    res.status(409).json({ error: "a bot with this id already exists" });
    return;
  }
  const created = createBot(botId, Array.isArray(roles) ? roles.map(String) : [], req.user!.sub);
  logAudit(req.user!.sub, "bot_created", null, `id=${created.id} roles=${created.roles.join(",")}`);
  res.status(201).json(created);
});

app.patch("/api/admin/bots/:id", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const { roles } = req.body ?? {};
  const updated = updateBotRoles(req.params.id, Array.isArray(roles) ? roles.map(String) : []);
  if (!updated) {
    res.status(404).json({ error: "not found" });
    return;
  }
  logAudit(req.user!.sub, "bot_updated", null, `id=${updated.id} roles=${updated.roles.join(",")}`);
  res.json(updated);
});

app.delete("/api/admin/bots/:id", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const ok = deleteBot(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "not found" });
    return;
  }
  logAudit(req.user!.sub, "bot_deleted", null, `id=${req.params.id}`);
  res.status(204).end();
});

// Bootstrap credential for this specific bot — reuses the exact same
// join-token mechanism agents already use (createJoinToken), scoped via
// subjectId so this token can only bootstrap this one bot's identity, not
// any other bot or the agent-join flow. Raw token shown once, same pattern
// as every other secret-on-creation flow in this app.
app.post("/api/admin/bots/:id/join-token", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const bot = findBot(req.params.id);
  if (!bot) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const { ttlMinutes, maxUses } = req.body ?? {};
  const created = createJoinToken(
    req.user!.sub,
    `bot:${bot.id}`,
    Number(maxUses) > 0 ? Number(maxUses) : 1,
    Number(ttlMinutes) > 0 ? Number(ttlMinutes) : 60,
    bot.id
  );
  logAudit(req.user!.sub, "bot_join_token_created", null, `botId=${bot.id} maxUses=${created.maxUses} ttlMinutes=${ttlMinutes ?? 60}`);
  res.status(201).json(created);
});

app.post("/api/admin/bots/:id/logout-everywhere", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const updated = bumpBotTokenVersion(req.params.id);
  if (!updated) {
    res.status(404).json({ error: "not found" });
    return;
  }
  logAudit(req.user!.sub, "bot_logged_out_everywhere", null, `id=${updated.id}`);
  res.status(204).end();
});

// Public — no auth, the join token itself is the credential. Exchanges a
// single/limited-use bootstrap token for a real, short-lived bot session
// token (15m — see BOT_TOKEN_TTL in auth.ts), the same shape a human's
// login response has (roles, tokenVersion baked in), just issued to a
// machine identity instead of a person.
app.post("/api/bots/join", (req, res) => {
  const token = String(req.body?.token ?? "");
  const clientIp = req.ip;
  const record = joinTokens.find((j) => j.token === token);
  if (!record || !record.subjectId) {
    logAudit("unknown", "bot_join_failed", null, "unknown or non-bot join token");
    res.status(401).json({ error: "invalid join token" });
    return;
  }
  const result = consumeJoinToken(token);
  if (!result.ok) {
    logAudit("unknown", "bot_join_failed", null, `botId=${record.subjectId} reason=${result.reason}`);
    res.status(401).json({ error: result.reason });
    return;
  }
  const bot = findBot(record.subjectId);
  if (!bot) {
    // Bot was deleted after its join token was issued — the token record
    // still exists (consumeJoinToken doesn't delete it), but there's no
    // identity left to bootstrap into.
    res.status(401).json({ error: "bot no longer exists" });
    return;
  }
  recordBotJoin(bot.id, clientIp);
  const sessionToken = signBotToken(bot.id, bot.roles, bot.tokenVersion);
  logAudit(`bot:${bot.id}`, "bot_joined", null, `roles=${bot.roles.join(",")}`);
  res.json({ token: sessionToken, botId: bot.id, roles: bot.roles });
});

// Rotation — a bot holding a still-valid (unexpired, unrevoked) token can
// mint a fresh one before it expires, without re-presenting its join
// token. This is the actual "continuously rotated credential" behavior;
// requireAuth already rejects an expired or revoked token before this
// handler ever runs, so reaching here already proves the caller holds a
// live bot session.
app.post("/api/bots/refresh", requireAuth, (req: AuthedRequest, res) => {
  if (!req.user!.isBot) {
    res.status(403).json({ error: "this endpoint is for bot identities only" });
    return;
  }
  const botId = req.user!.sub.slice(4); // strip "bot:" prefix
  const bot = findBot(botId);
  if (!bot) {
    res.status(401).json({ error: "bot no longer exists" });
    return;
  }
  const sessionToken = signBotToken(bot.id, bot.roles, bot.tokenVersion);
  res.json({ token: sessionToken, botId: bot.id, roles: bot.roles });
});

// ---------- REST API: admin — active sessions (live monitoring + termination,
// spans all four session types: ssh-agent/ssh-direct/rdp/database) ----------

function resourceLabelsFor(resourceId: string): Record<string, string> {
  return getConnection(resourceId)?.labels ?? agents.get(resourceId)?.labels ?? {};
}

app.get("/api/admin/sessions", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const now = Date.now();
  const all = [
    ...Array.from(sessions.values()).map((s) => ({
      id: s.id,
      username: s.username,
      resourceId: s.agentId,
      resourceHostname: s.resourceHostname,
      type: "ssh-agent",
      login: s.login,
      startedAt: s.startedAt,
      durationSeconds: Math.floor((now - s.startedAt) / 1000),
      watchers: spectatorCount(s.id),
    })),
    ...Array.from(otherSessions.values()).map((s) => ({
      id: s.id,
      username: s.username,
      resourceId: s.resourceId,
      resourceHostname: s.resourceHostname,
      type: s.type,
      login: null as string | null,
      startedAt: s.startedAt,
      durationSeconds: Math.floor((now - s.startedAt) / 1000),
      watchers: spectatorCount(s.id),
    })),
  ].sort((a, b) => b.startedAt - a.startedAt);

  const scoped = isFullAdmin(roles) ? all : all.filter((s) => canManageResource(roles, resourceLabelsFor(s.resourceId)));
  res.json(scoped);
});

app.delete("/api/admin/sessions/:id", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const entry = sessions.get(req.params.id) ?? otherSessions.get(req.params.id);
  if (!entry) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const resourceId = "agentId" in entry ? entry.agentId : entry.resourceId;
  if (!isFullAdmin(roles) && !canManageResource(roles, resourceLabelsFor(resourceId))) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  if (!entry.terminate) {
    res.status(409).json({ error: "session is still establishing, try again shortly" });
    return;
  }
  entry.terminate();
  logAudit(req.user!.sub, "session_terminated_by_admin", resourceId, `sessionId=${req.params.id} username=${entry.username}`);
  res.status(204).end();
});

// ---------- REST API: audit + recordings + notifications ----------

app.get("/api/audit", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  res.json(readAudit(200).filter(auditEventInScope(roles)));
});

// Full-admin only (not requireAnyAdmin) — this walks the entire,
// unscoped log file, not a tenant-filtered view, so a delegated admin
// shouldn't get it even read-only.
app.get("/api/admin/audit/verify", requireAuth, requireAdmin, (_req: AuthedRequest, res) => {
  res.json(verifyAuditChain());
});

// Aggregated data for the admin Dashboard page — all computed from data
// that already exists elsewhere (audit log, live resource/session maps),
// nothing new is tracked just for this. Same scoping rule as /api/audit:
// a delegated admin sees only their tenant's/labels' slice, not the whole
// deployment.
app.get("/api/admin/dashboard", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const roles = resolveRoles(req.user!.roles);
  const full = isFullAdmin(roles);
  const events = readAudit(5000).filter(auditEventInScope(roles));
  const now = Date.now();

  const resources = listResources().filter((r) => full || canManageResource(roles, r.labels));
  const resourcesByType: Record<string, number> = {};
  for (const r of resources) resourcesByType[r.type] = (resourcesByType[r.type] ?? 0) + 1;

  const allSessions = [
    ...Array.from(sessions.values()).map((s) => ({ resourceId: s.agentId })),
    ...Array.from(otherSessions.values()).map((s) => ({ resourceId: s.resourceId })),
  ];
  const activeSessions = allSessions.filter((s) => full || canManageResource(roles, resourceLabelsFor(s.resourceId))).length;

  const agentsInScope = Array.from(agents.values()).filter((a) => full || canManageResource(roles, a.labels));
  const usersInScope = full ? listUsers() : listUsers().filter((u) => canManageTenant(roles, u.tenant));

  const HOUR_MS = 3_600_000;
  const DAY_MS = 86_400_000;
  const eventsByHour = Array.from({ length: 24 }, (_, i) => {
    const bucketStart = now - (23 - i) * HOUR_MS;
    const bucketEnd = bucketStart + HOUR_MS;
    const inBucket = events.filter((e) => e.ts >= bucketStart && e.ts < bucketEnd);
    return {
      hour: new Date(bucketStart).toISOString(),
      login: inBucket.filter((e) => e.eventType === "login").length,
      login_failed: inBucket.filter((e) => e.eventType === "login_failed").length,
      session_start: inBucket.filter((e) => e.eventType === "session_start").length,
      access_denied: inBucket.filter((e) => e.eventType === "access_denied").length,
    };
  });

  const sessionsByDay = Array.from({ length: 7 }, (_, i) => {
    const bucketStart = now - (6 - i) * DAY_MS;
    const bucketEnd = bucketStart + DAY_MS;
    const count = events.filter((e) => e.eventType === "session_start" && e.ts >= bucketStart && e.ts < bucketEnd).length;
    return { day: new Date(bucketStart).toISOString().slice(0, 10), count };
  });

  res.json({
    kpis: {
      totalResources: resources.length,
      activeSessions,
      totalUsers: usersInScope.length,
      agentsOnline: agentsInScope.length,
      failedLogins24h: events.filter((e) => e.eventType === "login_failed" && e.ts > now - DAY_MS).length,
    },
    resourcesByType,
    eventsByHour,
    sessionsByDay,
    recentDenials: events.filter((e) => e.eventType === "access_denied").slice(0, 10),
    recentActivity: events.slice(0, 15),
    agentsList: agentsInScope.map((a) => ({ id: a.id, hostname: a.hostname, lastLatencyMs: a.lastLatencyMs, lastSeen: a.lastSeen, connectedAt: a.connectedAt })),
    // Monitors are a full-admin-only feature (see /api/monitors) — a
    // delegated admin's dashboard just won't have any to show, same as
    // every other full-admin-only surface already behaves here.
    monitorsList: full ? listMonitors().map((m) => ({ id: m.id, name: m.name, type: m.type, status: m.status, uptime24h: computeUptimePercent(m.id, 86_400_000) })) : [],
  });
});

// Per-user dashboard widget layout — a personal home-dashboard the same way
// Grafana's own home dashboard is per-user, not a single shared layout
// every admin is forced into. No default is stored server-side; a user who
// has never saved a layout gets `null` back and the frontend falls back to
// its own hardcoded starter set (see DEFAULT_WIDGETS in Dashboard.tsx) —
// keeps "what a new admin sees on day one" a frontend concern, not
// something that needs a backend migration if the starter set ever changes.
app.get("/api/dashboard/layout", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  res.json({ widgets: getDashboardLayout(req.user!.sub) ?? null });
});

app.put("/api/dashboard/layout", requireAuth, requireAnyAdmin, (req: AuthedRequest, res) => {
  const widgets = Array.isArray(req.body?.widgets) ? req.body.widgets : [];
  res.json({ widgets: setDashboardLayout(req.user!.sub, widgets) });
});

// ---------- Compliance report ----------
// Full-admin only, deliberately not requireAnyAdmin — a delegated admin's
// tenant-scoped view wouldn't produce a meaningful platform-wide posture
// report (e.g. "MFA adoption among privileged accounts" needs to see every
// account, not just their own tenant's).
app.get("/api/admin/compliance", requireAuth, requireAdmin, (_req, res) => {
  res.json(getComplianceReport());
});

// ---------- SIEM export (real-time signed webhook forwarding of the audit log) ----------
// Full-admin only, deliberately not requireAnyAdmin — this controls where
// the ENTIRE audit stream (every tenant's events) gets forwarded, not a
// delegated admin's own slice, so it's a platform-level setting.

function redactSiemConfig(config: ReturnType<typeof getSiemConfig>) {
  if (!config) return { enabled: false, webhookUrl: "", secretSet: false, secretPreview: "", updatedAt: null, updatedBy: null };
  return {
    enabled: config.enabled,
    webhookUrl: config.webhookUrl,
    secretSet: config.secret.length > 0,
    secretPreview: config.secret ? `••••${config.secret.slice(-4)}` : "",
    updatedAt: config.updatedAt,
    updatedBy: config.updatedBy,
  };
}

app.get("/api/admin/siem-config", requireAuth, requireAdmin, (_req, res) => {
  res.json(redactSiemConfig(getSiemConfig()));
});

app.post("/api/admin/siem-config", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const { enabled, webhookUrl, secret } = (req.body ?? {}) as { enabled?: boolean; webhookUrl?: string; secret?: string };
  const url = String(webhookUrl ?? "").trim();
  if (url) {
    try {
      new URL(url);
    } catch {
      res.status(400).json({ error: "invalid webhookUrl" });
      return;
    }
  }
  const existing = getSiemConfig();
  // An empty secret field means "keep the existing one" — the raw secret
  // is never sent back to the browser after being set (see
  // redactSiemConfig), so the edit form can't round-trip it even if it
  // wanted to.
  const resolvedSecret = typeof secret === "string" && secret.length > 0 ? secret : (existing?.secret ?? "");
  if (enabled && !url) {
    res.status(400).json({ error: "webhookUrl required to enable export" });
    return;
  }
  if (enabled && !resolvedSecret) {
    res.status(400).json({ error: "secret required to enable export (used to sign delivered events)" });
    return;
  }
  const saved = setSiemConfig({ enabled: Boolean(enabled), webhookUrl: url, secret: resolvedSecret }, req.user!.sub);
  logAudit(req.user!.sub, "siem_config_updated", null, `enabled=${saved.enabled} webhookUrl=${saved.webhookUrl || "(none)"}`);
  res.json(redactSiemConfig(saved));
});

app.post("/api/admin/siem-config/test", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const rl = webhookTestLimiter.check(req.user!.sub);
  if (!rl.allowed) {
    res.setHeader("Retry-After", String(rl.retryAfterSeconds));
    res.status(429).json({ error: `Too many test sends. Try again in ${rl.retryAfterSeconds}s.` });
    return;
  }
  webhookTestLimiter.recordFailure(req.user!.sub);
  const config = getSiemConfig();
  if (!config?.webhookUrl) {
    res.status(400).json({ error: "configure and save a webhook URL first" });
    return;
  }
  const testEvent: AuditEvent = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    username: req.user!.sub,
    eventType: "siem_test",
    resourceId: null,
    details: "manual test delivery from SIEM export settings",
  };
  const result = await deliverToSiem(testEvent);
  logAudit(req.user!.sub, "siem_test_sent", null, result.ok ? `delivered, HTTP ${result.status}` : `failed: ${result.error}`);
  res.json(result);
});

// ---------- SMTP alert email config ----------
// Same write-only-password / redact-then-return pattern as siem-config's
// secret field above — the raw password is never sent back to the browser
// after being set.

function redactSmtpConfig(config: SmtpConfig | null) {
  if (!config) return null;
  return {
    ...config,
    password: undefined,
    passwordSet: config.password.length > 0,
  };
}

app.get("/api/admin/smtp-config", requireAuth, requireAdmin, (_req, res) => {
  res.json(redactSmtpConfig(getSmtpConfig()));
});

app.post("/api/admin/smtp-config", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const body = (req.body ?? {}) as Partial<SmtpConfig>;
  const host = String(body.host ?? "").trim();
  const port = Number(body.port) || 0;
  const toAddresses = Array.isArray(body.toAddresses) ? body.toAddresses.map(String).filter(Boolean) : [];
  const existing = getSmtpConfig();
  const resolvedPassword = typeof body.password === "string" && body.password.length > 0 ? body.password : (existing?.password ?? "");
  if (body.enabled && (!host || !port)) {
    res.status(400).json({ error: "host and port required to enable alert email" });
    return;
  }
  if (body.enabled && toAddresses.length === 0) {
    res.status(400).json({ error: "at least one recipient address required to enable alert email" });
    return;
  }
  const saved = setSmtpConfig(
    {
      enabled: Boolean(body.enabled),
      host,
      port,
      secure: Boolean(body.secure),
      username: String(body.username ?? ""),
      password: resolvedPassword,
      fromAddress: String(body.fromAddress ?? ""),
      toAddresses,
    },
    req.user!.sub
  );
  logAudit(req.user!.sub, "smtp_config_updated", null, `enabled=${saved.enabled} host=${saved.host || "(none)"}`);
  res.json(redactSmtpConfig(saved));
});

app.post("/api/admin/smtp-config/test", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const config = getSmtpConfig();
  if (!config?.host) {
    res.status(400).json({ error: "configure and save SMTP settings first" });
    return;
  }
  const result = await sendTestEmail(config);
  logAudit(req.user!.sub, "smtp_test_sent", null, result.ok ? "delivered" : `failed: ${result.error}`);
  res.json(result);
});

// ---------- Security policy (org-wide MFA + admin IP allowlist) ----------
// Full-admin only, same as SIEM/SMTP config — this controls platform-wide
// auth policy, not something a tenant-scoped delegated admin should touch.

const CIDR_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(\/(\d{1,2}))?$/;
function isValidCidr(entry: string): boolean {
  const m = entry.match(CIDR_RE);
  if (!m) return false;
  const octets = [m[1], m[2], m[3], m[4]].map(Number);
  if (octets.some((o) => o > 255)) return false;
  if (m[6] !== undefined && Number(m[6]) > 32) return false;
  return true;
}

app.get("/api/admin/security-policy", requireAuth, requireAdmin, (_req, res) => {
  res.json(getSecurityPolicy());
});

app.post("/api/admin/security-policy", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const body = (req.body ?? {}) as Partial<SecurityPolicy>;
  const adminIpAllowlist = Array.isArray(body.adminIpAllowlist) ? body.adminIpAllowlist.map(String).map((s) => s.trim()).filter(Boolean) : [];
  const bad = adminIpAllowlist.find((entry) => !isValidCidr(entry));
  if (bad) {
    res.status(400).json({ error: `not a valid CIDR or IP: ${bad}` });
    return;
  }
  const saved = setSecurityPolicy({ requireMfaForAdmins: Boolean(body.requireMfaForAdmins), adminIpAllowlist }, req.user!.sub);
  logAudit(
    req.user!.sub,
    "security_policy_updated",
    null,
    `requireMfaForAdmins=${saved.requireMfaForAdmins} adminIpAllowlist=${saved.adminIpAllowlist.join(",") || "(none)"}`
  );
  res.json(saved);
});

// ---------- Uptime monitors ----------
// Full-admin only — same reasoning as SIEM/plugins: monitors can probe
// arbitrary hosts/ports/URLs, which is an operational + minor SSRF-adjacent
// capability that shouldn't be handed to a delegated (tenant-scoped) admin.

function serializeMonitor(m: Monitor) {
  return { ...m, uptime24h: computeUptimePercent(m.id, 24 * 60 * 60 * 1000), uptime7d: computeUptimePercent(m.id, 7 * 24 * 60 * 60 * 1000) };
}

const VALID_MONITOR_TYPES: MonitorType[] = ["http", "tcp", "keyword", "heartbeat"];

function monitorFromBody(body: Record<string, unknown>): { error: string } | { data: ReturnType<typeof buildMonitorData> } {
  const type = body.type as MonitorType;
  if (!VALID_MONITOR_TYPES.includes(type)) return { error: `type must be one of ${VALID_MONITOR_TYPES.join(", ")}` };
  const name = String(body.name ?? "").trim();
  if (!name) return { error: "name is required" };
  if ((type === "http" || type === "keyword") && !String(body.url ?? "").trim()) return { error: "url is required for http/keyword monitors" };
  if (type === "keyword" && !String(body.keyword ?? "").trim()) return { error: "keyword is required for keyword monitors" };
  if (type === "tcp" && (!String(body.host ?? "").trim() || !Number(body.port))) return { error: "host and port are required for tcp monitors" };
  if (type === "heartbeat" && !String(body.agentId ?? "").trim()) return { error: "agentId is required for heartbeat monitors" };
  return { data: buildMonitorData(body, type, name) };
}

function buildMonitorData(body: Record<string, unknown>, type: MonitorType, name: string) {
  return {
    name,
    type,
    enabled: body.enabled !== false,
    intervalSeconds: Math.max(Number(body.intervalSeconds) || 60, 15),
    timeoutMs: Math.max(Number(body.timeoutMs) || 10_000, 1000),
    retries: Math.max(Number(body.retries) || 0, 0),
    url: body.url ? String(body.url) : undefined,
    expectedStatusMin: body.expectedStatusMin ? Number(body.expectedStatusMin) : undefined,
    expectedStatusMax: body.expectedStatusMax ? Number(body.expectedStatusMax) : undefined,
    keyword: body.keyword ? String(body.keyword) : undefined,
    keywordShouldExist: body.keywordShouldExist !== false,
    host: body.host ? String(body.host) : undefined,
    port: body.port ? Number(body.port) : undefined,
    agentId: body.agentId ? String(body.agentId) : undefined,
  };
}

app.get("/api/monitors", requireAuth, requireAdmin, (_req, res) => {
  res.json(listMonitors().map(serializeMonitor));
});

app.get("/api/monitors/:id/checks", requireAuth, requireAdmin, (req, res) => {
  res.json(getMonitorChecks(req.params.id));
});

app.post("/api/monitors", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const parsed = monitorFromBody(req.body ?? {});
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const monitor = createMonitor(parsed.data, req.user!.sub);
  logAudit(req.user!.sub, "monitor_created", monitor.id, `Created monitor: ${monitor.name} (${monitor.type})`);
  res.status(201).json(serializeMonitor(monitor));
});

app.patch("/api/monitors/:id", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const existing = getMonitor(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "monitor not found" });
    return;
  }
  const merged = { ...existing, ...(req.body ?? {}) };
  const parsed = monitorFromBody(merged);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const updated = updateMonitor(req.params.id, parsed.data)!;
  logAudit(req.user!.sub, "monitor_updated", updated.id, `Updated monitor: ${updated.name}`);
  res.json(serializeMonitor(updated));
});

app.delete("/api/monitors/:id", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const removed = deleteMonitor(req.params.id);
  if (!removed) {
    res.status(404).json({ error: "monitor not found" });
    return;
  }
  logAudit(req.user!.sub, "monitor_deleted", removed.id, `Deleted monitor: ${removed.name}`);
  res.json({ ok: true });
});

app.post("/api/monitors/:id/test", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const monitor = getMonitor(req.params.id);
  if (!monitor) {
    res.status(404).json({ error: "monitor not found" });
    return;
  }
  const updated = await runMonitorCheck(monitor, onMonitorStatusChange);
  res.json(serializeMonitor(updated));
});

// ---------- Webhook plugins ----------
// Full-admin only — same reasoning as SIEM export: a plugin can fire on
// event types spanning every tenant, so this isn't a per-tenant delegated
// admin capability.

function redactPlugin(plugin: import("./store.js").WebhookPlugin) {
  return {
    id: plugin.id,
    name: plugin.name,
    enabled: plugin.enabled,
    eventTypes: plugin.eventTypes,
    webhookUrl: plugin.webhookUrl,
    secretSet: plugin.secret.length > 0,
    secretPreview: plugin.secret ? `••••${plugin.secret.slice(-4)}` : "",
    createdAt: plugin.createdAt,
    createdBy: plugin.createdBy,
    updatedAt: plugin.updatedAt,
  };
}

app.get("/api/admin/plugins", requireAuth, requireAdmin, (_req, res) => {
  res.json(listWebhookPlugins().map(redactPlugin));
});

app.post("/api/admin/plugins", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const { name, enabled, eventTypes, webhookUrl, secret } = (req.body ?? {}) as {
    name?: string;
    enabled?: boolean;
    eventTypes?: string[];
    webhookUrl?: string;
    secret?: string;
  };
  const url = String(webhookUrl ?? "").trim();
  if (!name || !url) {
    res.status(400).json({ error: "name and webhookUrl are required" });
    return;
  }
  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: "invalid webhookUrl" });
    return;
  }
  if (enabled && !secret) {
    res.status(400).json({ error: "secret required to enable a plugin (used to sign delivered events)" });
    return;
  }
  const plugin = createWebhookPlugin({
    name,
    enabled: Boolean(enabled),
    eventTypes: Array.isArray(eventTypes) ? eventTypes : [],
    webhookUrl: url,
    secret: secret ?? "",
    createdBy: req.user!.sub,
  });
  logAudit(req.user!.sub, "plugin_created", plugin.id, `name=${plugin.name} eventTypes=${plugin.eventTypes.join(",") || "(all)"}`);
  res.status(201).json(redactPlugin(plugin));
});

app.patch("/api/admin/plugins/:id", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const existing = getWebhookPlugin(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "plugin not found" });
    return;
  }
  const { name, enabled, eventTypes, webhookUrl, secret } = (req.body ?? {}) as {
    name?: string;
    enabled?: boolean;
    eventTypes?: string[];
    webhookUrl?: string;
    secret?: string;
  };
  if (webhookUrl !== undefined) {
    try {
      new URL(webhookUrl);
    } catch {
      res.status(400).json({ error: "invalid webhookUrl" });
      return;
    }
  }
  const resolvedSecret = typeof secret === "string" && secret.length > 0 ? secret : existing.secret;
  const resolvedEnabled = enabled !== undefined ? Boolean(enabled) : existing.enabled;
  if (resolvedEnabled && !resolvedSecret) {
    res.status(400).json({ error: "secret required to enable a plugin (used to sign delivered events)" });
    return;
  }
  const updated = updateWebhookPlugin(req.params.id, {
    ...(name !== undefined ? { name } : {}),
    ...(webhookUrl !== undefined ? { webhookUrl } : {}),
    eventTypes: Array.isArray(eventTypes) ? eventTypes : existing.eventTypes,
    secret: resolvedSecret,
    enabled: resolvedEnabled,
  })!;
  logAudit(req.user!.sub, "plugin_updated", updated.id, `name=${updated.name} enabled=${updated.enabled}`);
  res.json(redactPlugin(updated));
});

app.delete("/api/admin/plugins/:id", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const plugin = getWebhookPlugin(req.params.id);
  if (!deleteWebhookPlugin(req.params.id)) {
    res.status(404).json({ error: "plugin not found" });
    return;
  }
  logAudit(req.user!.sub, "plugin_deleted", req.params.id, `name=${plugin?.name}`);
  res.json({ ok: true });
});

app.post("/api/admin/plugins/:id/test", requireAuth, requireAdmin, async (req: AuthedRequest, res) => {
  const rl = webhookTestLimiter.check(req.user!.sub);
  if (!rl.allowed) {
    res.setHeader("Retry-After", String(rl.retryAfterSeconds));
    res.status(429).json({ error: `Too many test sends. Try again in ${rl.retryAfterSeconds}s.` });
    return;
  }
  webhookTestLimiter.recordFailure(req.user!.sub);
  const plugin = getWebhookPlugin(req.params.id);
  if (!plugin) {
    res.status(404).json({ error: "plugin not found" });
    return;
  }
  const testEvent: AuditEvent = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    username: req.user!.sub,
    eventType: "plugin_test",
    resourceId: null,
    details: `manual test delivery for plugin ${plugin.name}`,
  };
  const result = await deliverToPlugin(plugin, testEvent);
  logAudit(req.user!.sub, "plugin_test_sent", plugin.id, result.ok ? `delivered, HTTP ${result.status}` : `failed: ${result.error}`);
  res.json(result);
});

// Lightweight feed for the notification bell. Admins (full or delegated)
// get the same tenant-scoped view /api/audit and the Dashboard use, so a
// delegated admin sees access-denied/new-connection events for their own
// tenant, not just their own actions. A plain user (no admin role at all)
// has no "tenant" to scope by, so they fall back to their own events only.
const NOTIFICATION_EVENT_TYPES = new Set(["access_denied", "session_ttl_expired", "session_error", "connection_created", "user_created", "monitor_down", "monitor_up"]);

function scopedNotifications(req: AuthedRequest, limitEvents: number): AuditEvent[] {
  const roles = resolveRoles(req.user!.roles);
  const events = readAudit(limitEvents).filter((e) => NOTIFICATION_EVENT_TYPES.has(e.eventType));
  return isAnyAdmin(roles) ? events.filter(auditEventInScope(roles)) : events.filter((e) => e.username === req.user!.sub);
}

// Dropdown feed: only what's new since the user last cleared it, capped to
// 10 — a quick glance, not the record. See /api/notifications/history for
// the full picture.
app.get("/api/notifications", requireAuth, (req: AuthedRequest, res) => {
  const clearedAt = getNotificationClearedAt(req.user!.sub);
  const scoped = scopedNotifications(req, 300).filter((e) => e.ts > clearedAt);
  res.json(scoped.slice(0, 10));
});

// Clearing only resets the dropdown's watermark — it does NOT delete or
// hide anything from /api/notifications/history, which stays a real
// history the same way the audit log itself is never edited or deleted.
app.post("/api/notifications/clear", requireAuth, (req: AuthedRequest, res) => {
  const clearedAt = clearNotificationsFor(req.user!.sub);
  res.json({ clearedAt });
});

// Full history, independent of the dropdown's cleared watermark — up to
// `days` back (default/max 30, matching what was asked for). Same scoping
// as the dropdown, just a longer window and no cap.
app.get("/api/notifications/history", requireAuth, (req: AuthedRequest, res) => {
  const days = Math.min(Number(req.query.days) || 30, 30);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const clearedAt = getNotificationClearedAt(req.user!.sub);
  const scoped = scopedNotifications(req, 100_000).filter((e) => e.ts > cutoff);
  res.json({ clearedAt, events: scoped });
});

// Recordings are just files named by sessionId — cross-reference the audit
// log's session_start events (which do carry sessionId/resource/username in
// their details text) so the Recordings page can show and filter by who/what
// instead of a bare uuid.
function recordingMetadataIndex(): Map<string, { username: string; resource: string; type: string }> {
  const index = new Map<string, { username: string; resource: string; type: string }>();
  for (const event of readAudit(2000)) {
    if (event.eventType !== "session_start") continue;
    const sessionIdMatch = event.details.match(/sessionId=(\S+)/);
    const resourceMatch = event.details.match(/resource=(\S+)/);
    const typeMatch = event.details.match(/type=(\S+)/);
    const sessionId = sessionIdMatch?.[1] ?? event.resourceId ?? "";
    if (!sessionId) continue;
    index.set(sessionId, {
      username: event.username,
      resource: resourceMatch?.[1] ?? event.resourceId ?? "unknown",
      type: typeMatch?.[1] ?? "ssh",
    });
  }
  return index;
}

app.get("/api/recordings", requireAuth, requireAdmin, (_req, res) => {
  const metadata = recordingMetadataIndex();
  const files = fs
    .readdirSync(RECORDINGS_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      const sessionId = f.replace(".jsonl", "");
      const stat = fs.statSync(path.join(RECORDINGS_DIR, f));
      const meta = metadata.get(sessionId);
      return {
        sessionId,
        sizeBytes: stat.size,
        modifiedAt: stat.mtimeMs,
        username: meta?.username ?? "unknown",
        resource: meta?.resource ?? "unknown",
        type: meta?.type ?? "ssh-agent",
      };
    })
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
  res.json(files);
});

// Real session ids are always crypto.randomUUID() output — hex + hyphens
// only. Without this check, `sessionId=../../audit` resolves outside
// RECORDINGS_DIR entirely; both routes are already admin-gated, but an
// admin shouldn't be able to read/delete arbitrary files on the host
// (including the audit log itself) through an endpoint that's supposed to
// only ever touch recordings.
const SAFE_SESSION_ID = /^[a-zA-Z0-9-]+$/;

app.get("/api/recordings/:sessionId", requireAuth, requireAdmin, (req, res) => {
  if (!SAFE_SESSION_ID.test(req.params.sessionId)) {
    res.status(400).json({ error: "invalid session id" });
    return;
  }
  const filePath = path.join(RECORDINGS_DIR, `${req.params.sessionId}.jsonl`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const frames = fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const type = recordingMetadataIndex().get(req.params.sessionId)?.type ?? "ssh-agent";
  res.json({ type, frames });
});

app.delete("/api/recordings/:sessionId", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  if (!SAFE_SESSION_ID.test(req.params.sessionId)) {
    res.status(400).json({ error: "invalid session id" });
    return;
  }
  const filePath = path.join(RECORDINGS_DIR, `${req.params.sessionId}.jsonl`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "not found" });
    return;
  }
  fs.unlinkSync(filePath);
  logAudit(req.user!.sub, "recording_deleted", null, `sessionId=${req.params.sessionId}`);
  res.status(204).end();
});

const server = http.createServer(app);

// ---------- WebSocket: agents (control plane <- agent, outbound-only) ----------

const agentWss = new WebSocketServer({ noServer: true });

agentWss.on("connection", (socket, req) => {
  const url = new URL(req.url ?? "", "http://internal");
  const token = url.searchParams.get("token");
  const id = url.searchParams.get("id");
  const hostname = url.searchParams.get("hostname") ?? id;
  const labelsRaw = url.searchParams.get("labels") ?? "{}";
  const type = url.searchParams.get("type") ?? "ssh-agent";
  const version = url.searchParams.get("version") ?? "unknown";
  const publicKey = url.searchParams.get("publicKey");
  const signature = url.searchParams.get("signature");
  const timestamp = url.searchParams.get("timestamp");

  if (!id) {
    socket.close(4001, "unauthorized");
    return;
  }

  // Three ways in, checked in order of how much they actually prove:
  // (1) a previously-registered agent re-authenticating by signing a fresh
  // challenge with its own private key — no token involved at all; (2) a
  // brand-new agent bootstrapping its identity with a real single-use join
  // token; (3) the legacy static shared-secret path, kept only so the
  // existing demo agents (started via start.sh, never migrated) keep
  // working — every real deployment should be on (1)/(2).
  let authMethod: "identity" | "join-token" | "legacy-shared-token" | null = null;

  if (signature && timestamp && verifyAgentChallenge(id, timestamp, signature)) {
    authMethod = "identity";
  } else if (token && token !== AGENT_JOIN_TOKEN && publicKey) {
    const joinResult = consumeJoinToken(token);
    if (!joinResult.ok) {
      logAudit("system", "agent_join_denied", id, joinResult.reason);
      socket.close(4001, joinResult.reason);
      return;
    }
    const usedToken = listJoinTokens().find((t) => t.token === token);
    registerAgentIdentity(id, publicKey, usedToken?.label ?? "");
    logAudit("system", "agent_joined", id, `via join-token label="${usedToken?.label ?? ""}"`);
    authMethod = "join-token";
  } else if (token === AGENT_JOIN_TOKEN) {
    authMethod = "legacy-shared-token";
  }

  if (!authMethod) {
    logAudit("system", "agent_join_denied", id, "no valid token or identity signature presented");
    socket.close(4001, "unauthorized");
    return;
  }

  const labels = JSON.parse(labelsRaw);
  const now = Date.now();
  agents.set(id, { id, hostname: hostname!, labels, type, socket, connectedAt: now, version, lastSeen: now, lastLatencyMs: null });
  console.log(`[agent] connected: ${id} (${hostname}) type=${type} labels=${labelsRaw} auth=${authMethod}`);
  socket.send(
    JSON.stringify({
      type: "registered",
      latestVersion: AGENT_LATEST_VERSION,
      // Only true when the control plane actually has this agent's public
      // key on file — the agent uses this (not just "did I get a
      // 'registered' message") to decide whether it's safe to switch to
      // signature-based reconnects. A legacy-shared-token join never
      // registers an identity, so telling that agent "you're confirmed"
      // would make its NEXT reconnect attempt sign a challenge the server
      // has nothing to verify it against — a self-inflicted lockout.
      identityRegistered: authMethod === "join-token" || authMethod === "identity",
    })
  );

  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      // <sessionId (36 bytes ascii)><pty output bytes> — route to the browser socket
      const buf = data as Buffer;
      const sessionId = buf.subarray(0, SESSION_ID_LEN).toString("ascii");
      const payload = buf.subarray(SESSION_ID_LEN);
      const session = sessions.get(sessionId);
      if (!session) return;
      appendRecording(session, "o", payload);
      if (session.browserSocket.readyState === WebSocket.OPEN) {
        session.browserSocket.send(payload);
      }
      broadcastToSpectators(sessionId, payload);
    } else {
      const msg = JSON.parse(data.toString());
      if (msg.type === "closed") {
        const session = sessions.get(msg.sessionId);
        if (session) {
          if (session.ttlTimer) clearTimeout(session.ttlTimer);
          session.recordingStream.end();
          if (session.browserSocket.readyState === WebSocket.OPEN) session.browserSocket.close();
          logAudit(session.username, "session_end", session.agentId, `resource=${session.resourceHostname} sessionId=${msg.sessionId}`);
          sessions.delete(msg.sessionId);
        }
      } else if (msg.type === "error") {
        // The agent accepted the "open" request but couldn't actually
        // start the session at all (PTY spawn failed). Surface the real
        // reason instead of leaving the browser hanging on a session that
        // will never produce output.
        const session = sessions.get(msg.sessionId);
        if (session) {
          if (session.ttlTimer) clearTimeout(session.ttlTimer);
          session.recordingStream.end();
          logAudit(session.username, "session_error", session.agentId, `sessionId=${msg.sessionId}: ${msg.message}`);
          if (session.browserSocket.readyState === WebSocket.OPEN) session.browserSocket.close(1011, String(msg.message ?? "session failed").slice(0, 120));
          sessions.delete(msg.sessionId);
        }
      } else if (msg.type === "session-info") {
        // Whether the agent actually impersonated the requested OS login
        // (real uid/gid switch) or fell back to running as its own user —
        // see agent/src/impersonate.ts. Logged as its own audit event
        // (not folded into session_start's details, which is already
        // written before the agent replies) so "was this session actually
        // running as who it claims" is a real, searchable, honest fact
        // instead of an assumption.
        const session = sessions.get(msg.sessionId);
        if (session) {
          logAudit(
            session.username,
            "session_login_status",
            session.agentId,
            `sessionId=${msg.sessionId} requestedLogin=${session.login} actualUser=${msg.actualUser} impersonated=${msg.impersonated}${msg.fallbackReason ? ` reason="${msg.fallbackReason}"` : ""}`
          );
        }
      } else if (msg.type === "ping") {
        const agentInfo = agents.get(id);
        if (agentInfo) {
          agentInfo.lastSeen = Date.now();
          // Clocks aren't synchronized between processes, so this is an
          // approximation, not a true network RTT — good enough to spot a
          // agent whose clock/connectivity has drifted badly, not precise
          // enough to alert on.
          agentInfo.lastLatencyMs = Math.max(0, Date.now() - msg.ts);
        }
      } else if (typeof msg.type === "string" && msg.type.startsWith("file-") && msg.requestId) {
        resolveAgentFileRequest(msg.requestId, msg);
      }
    }
  });

  socket.on("close", () => {
    console.log(`[agent] disconnected: ${id}`);
    // Only tear down state if this closing socket is still the one the
    // `agents` map actually points at for this id — a second connection
    // for the same agent id can already have replaced it (self-update's
    // brief overlap between the old process exiting and the new one
    // having connected, or any ordinary fast reconnect race). Without
    // this check, the stale socket's belated close event would wipe out
    // the NEW, live agent's entry and kill ITS sessions instead of doing
    // nothing, which is what should happen for a socket nobody's tracking
    // as current anymore. Found by testing self-update against a real
    // running agent, not by inspection.
    if (agents.get(id)?.socket !== socket) return;
    agents.delete(id);
    for (const [sessionId, session] of sessions) {
      if (session.agentId === id) {
        if (session.ttlTimer) clearTimeout(session.ttlTimer);
        session.recordingStream.end();
        if (session.browserSocket.readyState === WebSocket.OPEN) session.browserSocket.close();
        sessions.delete(sessionId);
      }
    }
  });
});

// ---------- WebSocket: browser sessions (SSH via reverse-tunnel agent) ----------

const sessionWss = new WebSocketServer({ noServer: true });

sessionWss.on("connection", async (browserSocket, req) => {
  const url = new URL(req.url ?? "", "http://internal");
  const token = url.searchParams.get("token");
  const resourceId = url.searchParams.get("resourceId");
  const login = url.searchParams.get("login") ?? "demo";
  const clientIp = req.socket.remoteAddress ?? "";

  const payload = token ? verifyTokenLive(token) : null;
  if (!payload || !resourceId) {
    browserSocket.close(4001, "unauthorized");
    return;
  }

  // Live roles, not the JWT's login-time snapshot — same reasoning as
  // requireAuth in auth.ts: a role grant/revoke must take effect on the
  // very next connection attempt, not only after a fresh login.
  const roles = resolveRoles(payload.roles);
  const agent = agents.get(resourceId);

  const grantedByRequest = hasActiveGrant(payload.sub, resourceId, login);
  if (!agent || (!canAccessResource(roles, agent, payload.sub) && !grantedByRequest)) {
    const reason = "resource not visible under current role";
    logAudit(payload.sub, "access_denied", resourceId, reason);
    browserSocket.close(4003, reason);
    return;
  }
  if (!loginAllowed(roles, login) && !grantedByRequest) {
    const reason = `login "${login}" not permitted by any assigned role`;
    logAudit(payload.sub, "access_denied", resourceId, reason);
    browserSocket.close(4003, reason);
    return;
  }
  if (!ipAllowed(roles, clientIp)) {
    const reason = `source ip ${clientIp} outside role's allowed CIDRs`;
    logAudit(payload.sub, "access_denied", resourceId, reason);
    browserSocket.close(4003, reason);
    return;
  }

  // ─── Moderated Sessions check ──────────────────────────────────────────
  const needsModeration = roles.some((r) => r.requireSessionModeration);
  if (needsModeration) {
    const { awaitModeration, cancelPendingSession } = await import("./moderatedSessions.js");
    const moderationSessionId = crypto.randomUUID();
    browserSocket.send(JSON.stringify({ type: "moderation_pending", message: "Waiting for a moderator to join..." }));
    logAudit(payload.sub, "session_moderation_pending", resourceId, `Waiting for moderator`);

    const moderationTimeout = 300; // 5 minutes
    try {
      await awaitModeration(moderationSessionId, resourceId, agent.hostname, payload.sub, {
        required: true, minModerators: 1, onModeratorLeave: "terminate", timeoutSeconds: moderationTimeout,
      });
      browserSocket.send(JSON.stringify({ type: "moderation_approved", message: "Moderator joined. Session starting." }));
      logAudit(payload.sub, "session_moderation_approved", resourceId, `Moderator joined`);
    } catch {
      logAudit(payload.sub, "session_moderation_timeout", resourceId, `No moderator joined within ${moderationTimeout}s`);
      browserSocket.close(4009, "No moderator joined in time");
      cancelPendingSession(moderationSessionId);
      return;
    }
    // Clean up on disconnect before moderation completes
    browserSocket.on("close", () => cancelPendingSession(moderationSessionId));
  }

  const sessionId = crypto.randomUUID();
  const session: SessionInfo = {
    id: sessionId,
    agentId: agent.id,
    resourceHostname: agent.hostname,
    browserSocket,
    username: payload.sub,
    login,
    startedAt: Date.now(),
    recordingStream: startRecording(sessionId),
  };

  session.terminate = () => {
    if (agent.socket.readyState === WebSocket.OPEN) agent.socket.send(JSON.stringify({ type: "close", sessionId }));
    if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(4008, "session terminated");
  };

  const ttlMinutes = effectiveSessionTTLMinutes(roles);
  if (ttlMinutes !== null) {
    session.ttlTimer = setTimeout(() => {
      logAudit(payload.sub, "session_ttl_expired", agent.id, `sessionId=${sessionId} ttlMinutes=${ttlMinutes}`);
      session.terminate!();
    }, ttlMinutes * 60_000);
  }

  sessions.set(sessionId, session);
  logAudit(payload.sub, "session_start", agent.id, `resource=${agent.hostname} login=${login} sessionId=${sessionId}`);

  agent.socket.send(JSON.stringify({ type: "open", sessionId, login }));

  browserSocket.on("message", (data, isBinary) => {
    if (isBinary) {
      appendRecording(session, "i", data as Buffer);
      const framed = Buffer.concat([Buffer.from(sessionId, "ascii"), data as Buffer]);
      if (agent.socket.readyState === WebSocket.OPEN) agent.socket.send(framed);
    } else {
      const msg = JSON.parse(data.toString());
      if (msg.type === "resize" && agent.socket.readyState === WebSocket.OPEN) {
        agent.socket.send(JSON.stringify({ type: "resize", sessionId, cols: msg.cols, rows: msg.rows }));
      }
    }
  });

  browserSocket.on("close", () => {
    if (session.ttlTimer) clearTimeout(session.ttlTimer);
    if (agent.socket.readyState === WebSocket.OPEN) {
      agent.socket.send(JSON.stringify({ type: "close", sessionId }));
    }
    session.recordingStream.end();
    logAudit(payload.sub, "session_end", agent.id, `resource=${agent.hostname} sessionId=${sessionId}`);
    sessions.delete(sessionId);
  });
});

// ---------- shared: resolve + authorize a directly-dialed connection ----------

function authorizeConnectionSession(
  roles: ReturnType<typeof resolveRoles>,
  connectionId: string,
  expectedType: ConnectionType,
  username: string
): { ok: true; conn: Connection } | { ok: false; reason: string } {
  const conn = getConnection(connectionId);
  if (!conn || conn.type !== expectedType) {
    return { ok: false, reason: "resource not visible under current role" };
  }
  const grantedByRequest = hasActiveGrant(username, connectionId, conn.username);
  if (!canAccessResource(roles, { labels: conn.labels, type: conn.type, assignedUsers: conn.assignedUsers }, username) && !grantedByRequest) {
    return { ok: false, reason: "resource not visible under current role" };
  }
  if (!loginAllowed(roles, conn.username) && !grantedByRequest) {
    return { ok: false, reason: `login "${conn.username}" not permitted by any assigned role` };
  }
  return { ok: true, conn };
}

// ---------- WebSocket: browser sessions (RDP, via guacd) ----------

const rdpWss = new WebSocketServer({ noServer: true });

rdpWss.on("connection", async (browserSocket, req) => {
  const url = new URL(req.url ?? "", "http://internal");
  const token = url.searchParams.get("token");
  const resourceId = url.searchParams.get("resourceId");
  const width = url.searchParams.get("w") ?? "1024";
  const height = url.searchParams.get("h") ?? "768";
  const clientIp = req.socket.remoteAddress ?? "";

  const payload = token ? verifyTokenLive(token) : null;
  if (!payload || !resourceId) {
    browserSocket.close(4001, "unauthorized");
    return;
  }

  // Live roles, not the JWT's login-time snapshot — same reasoning as
  // requireAuth in auth.ts: a role grant/revoke must take effect on the
  // very next connection attempt, not only after a fresh login.
  const roles = resolveRoles(payload.roles);
  const auth = authorizeConnectionSession(roles, resourceId, "rdp", payload.sub);
  if (!auth.ok) {
    logAudit(payload.sub, "access_denied", resourceId, auth.reason);
    browserSocket.close(4003, auth.reason);
    return;
  }
  if (!ipAllowed(roles, clientIp)) {
    const ipReason = `source ip ${clientIp} outside role's allowed CIDRs`;
    logAudit(payload.sub, "access_denied", resourceId, ipReason);
    browserSocket.close(4003, ipReason);
    return;
  }
  const target = auth.conn;

  let guacdSocket: import("node:net").Socket | undefined;
  let ttlTimer: NodeJS.Timeout | undefined;
  try {
    const conn = await connectToGuacd(GUACD_HOST, GUACD_PORT, {
      protocol: "rdp",
      hostname: target.host,
      port: String(target.port),
      username: target.username,
      password: target.password,
      width,
      height,
      dpi: "96",
      allowClipboard: clipboardAllowed(roles),
    });
    guacdSocket = conn.socket;

    if (browserSocket.readyState !== WebSocket.OPEN) {
      guacdSocket.destroy();
      return;
    }

    const sessionId = crypto.randomUUID();
    logAudit(payload.sub, "session_start", target.id, `resource=${target.hostname} type=rdp login=${target.username} sessionId=${sessionId}`);
    if (conn.leftover) browserSocket.send(conn.leftover);

    // Recorded exactly like ssh-direct: raw Guacamole protocol text frames,
    // one recordingStream per session, {t, dir, data} lines. Replay.tsx
    // feeds these straight back into a read-only GuacClient (the same
    // renderer WatchSession.tsx uses for live co-watching) instead of the
    // xterm.js used for SSH replay — same file format, different player.
    const recordingStream = startRecording(sessionId);
    const startedAt = Date.now();
    const record = (dir: "i" | "o", data: string) => {
      recordingStream.write(JSON.stringify({ t: Date.now() - startedAt, dir, data: Buffer.from(data, "utf8").toString("base64") }) + "\n");
    };

    const terminate = () => {
      guacdSocket?.destroy();
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(4008, "session terminated");
    };
    otherSessions.set(sessionId, {
      id: sessionId,
      username: payload.sub,
      resourceId: target.id,
      resourceHostname: target.hostname,
      type: "rdp",
      startedAt,
      terminate,
    });

    const ttlMinutes = effectiveSessionTTLMinutes(roles);
    if (ttlMinutes !== null) {
      ttlTimer = setTimeout(() => {
        logAudit(payload.sub, "session_ttl_expired", target.id, `ttlMinutes=${ttlMinutes} sessionId=${sessionId}`);
        terminate();
      }, ttlMinutes * 60_000);
    }

    guacdSocket.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(text);
      broadcastToSpectators(sessionId, text);
      record("o", text);
    });
    guacdSocket.on("close", () => {
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close();
    });
    guacdSocket.on("error", () => {
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(1011, "guacd connection error");
    });

    browserSocket.on("message", (data) => {
      const text = data.toString("utf8");
      guacdSocket?.write(text);
      record("i", text);
    });
    browserSocket.on("close", () => {
      if (ttlTimer) clearTimeout(ttlTimer);
      recordingStream.end();
      guacdSocket?.destroy();
      otherSessions.delete(sessionId);
      logAudit(payload.sub, "session_end", target.id, `resource=${target.hostname} type=rdp sessionId=${sessionId}`);
    });
  } catch (err) {
    console.error("[rdp] guacd connect failed:", err);
    logAudit(payload.sub, "session_error", resourceId, `guacd connect failed: ${(err as Error).message}`);
    browserSocket.close(1011, (err as Error).message.slice(0, 120));
  }
});

// ---------- WebSocket: browser sessions (VNC, via guacd) ----------
// Mirrors rdpWss above line-for-line — guacd already speaks VNC natively
// (compiled with libvncclient), so this is a protocol swap at the guac.ts
// handshake layer, not new session architecture. See guac.ts's
// RdpConnectParams.protocol for the one real change.

const vncWss = new WebSocketServer({ noServer: true });

vncWss.on("connection", async (browserSocket, req) => {
  const url = new URL(req.url ?? "", "http://internal");
  const token = url.searchParams.get("token");
  const resourceId = url.searchParams.get("resourceId");
  const width = url.searchParams.get("w") ?? "1024";
  const height = url.searchParams.get("h") ?? "768";
  const clientIp = req.socket.remoteAddress ?? "";

  const payload = token ? verifyTokenLive(token) : null;
  if (!payload || !resourceId) {
    browserSocket.close(4001, "unauthorized");
    return;
  }

  // Live roles, not the JWT's login-time snapshot — same reasoning as
  // requireAuth in auth.ts: a role grant/revoke must take effect on the
  // very next connection attempt, not only after a fresh login.
  const roles = resolveRoles(payload.roles);
  const auth = authorizeConnectionSession(roles, resourceId, "vnc", payload.sub);
  if (!auth.ok) {
    logAudit(payload.sub, "access_denied", resourceId, auth.reason);
    browserSocket.close(4003, auth.reason);
    return;
  }
  if (!ipAllowed(roles, clientIp)) {
    const ipReason = `source ip ${clientIp} outside role's allowed CIDRs`;
    logAudit(payload.sub, "access_denied", resourceId, ipReason);
    browserSocket.close(4003, ipReason);
    return;
  }
  const target = auth.conn;

  let guacdSocket: import("node:net").Socket | undefined;
  let ttlTimer: NodeJS.Timeout | undefined;
  try {
    const conn = await connectToGuacd(GUACD_HOST, GUACD_PORT, {
      protocol: "vnc",
      hostname: target.host,
      port: String(target.port),
      username: target.username,
      password: target.password,
      width,
      height,
      dpi: "96",
      allowClipboard: clipboardAllowed(roles),
    });
    guacdSocket = conn.socket;

    if (browserSocket.readyState !== WebSocket.OPEN) {
      guacdSocket.destroy();
      return;
    }

    const sessionId = crypto.randomUUID();
    logAudit(payload.sub, "session_start", target.id, `resource=${target.hostname} type=vnc login=${target.username} sessionId=${sessionId}`);
    if (conn.leftover) browserSocket.send(conn.leftover);

    // Recorded exactly like rdp: raw Guacamole protocol text frames, one
    // recordingStream per session, {t, dir, data} lines. Replay.tsx feeds
    // these straight back into a read-only GuacClient (the same renderer
    // WatchSession.tsx uses for live co-watching) — same file format RDP
    // uses, since both protocols speak the identical Guacamole wire
    // format once guacd normalizes them.
    const recordingStream = startRecording(sessionId);
    const startedAt = Date.now();
    const record = (dir: "i" | "o", data: string) => {
      recordingStream.write(JSON.stringify({ t: Date.now() - startedAt, dir, data: Buffer.from(data, "utf8").toString("base64") }) + "\n");
    };

    const terminate = () => {
      guacdSocket?.destroy();
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(4008, "session terminated");
    };
    otherSessions.set(sessionId, {
      id: sessionId,
      username: payload.sub,
      resourceId: target.id,
      resourceHostname: target.hostname,
      type: "vnc",
      startedAt,
      terminate,
    });

    const ttlMinutes = effectiveSessionTTLMinutes(roles);
    if (ttlMinutes !== null) {
      ttlTimer = setTimeout(() => {
        logAudit(payload.sub, "session_ttl_expired", target.id, `ttlMinutes=${ttlMinutes} sessionId=${sessionId}`);
        terminate();
      }, ttlMinutes * 60_000);
    }

    guacdSocket.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(text);
      broadcastToSpectators(sessionId, text);
      record("o", text);
    });
    guacdSocket.on("close", () => {
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close();
    });
    guacdSocket.on("error", () => {
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(1011, "guacd connection error");
    });

    browserSocket.on("message", (data) => {
      const text = data.toString("utf8");
      guacdSocket?.write(text);
      record("i", text);
    });
    browserSocket.on("close", () => {
      if (ttlTimer) clearTimeout(ttlTimer);
      recordingStream.end();
      guacdSocket?.destroy();
      otherSessions.delete(sessionId);
      logAudit(payload.sub, "session_end", target.id, `resource=${target.hostname} type=vnc sessionId=${sessionId}`);
    });
  } catch (err) {
    console.error("[vnc] guacd connect failed:", err);
    logAudit(payload.sub, "session_error", resourceId, `guacd connect failed: ${(err as Error).message}`);
    browserSocket.close(1011, (err as Error).message.slice(0, 120));
  }
});

// ---------- WebSocket: browser sessions (direct-dial SSH, no agent) ----------

const sshDirectWss = new WebSocketServer({ noServer: true });

sshDirectWss.on("connection", (browserSocket, req) => {
  const url = new URL(req.url ?? "", "http://internal");
  const token = url.searchParams.get("token");
  const resourceId = url.searchParams.get("resourceId");
  const clientIp = req.socket.remoteAddress ?? "";

  const payload = token ? verifyTokenLive(token) : null;
  if (!payload || !resourceId) {
    browserSocket.close(4001, "unauthorized");
    return;
  }

  // Live roles, not the JWT's login-time snapshot — same reasoning as
  // requireAuth in auth.ts: a role grant/revoke must take effect on the
  // very next connection attempt, not only after a fresh login.
  const roles = resolveRoles(payload.roles);
  const auth = authorizeConnectionSession(roles, resourceId, "ssh-direct", payload.sub);
  if (!auth.ok) {
    logAudit(payload.sub, "access_denied", resourceId, auth.reason);
    browserSocket.close(4003, auth.reason);
    return;
  }
  if (!ipAllowed(roles, clientIp)) {
    const ipReason = `source ip ${clientIp} outside role's allowed CIDRs`;
    logAudit(payload.sub, "access_denied", resourceId, ipReason);
    browserSocket.close(4003, ipReason);
    return;
  }
  const target = auth.conn;

  const sessionId = crypto.randomUUID();
  const recordingStream = startRecording(sessionId);
  const startedAt = Date.now();
  const record = (dir: "i" | "o", data: Buffer) => {
    recordingStream.write(JSON.stringify({ t: Date.now() - startedAt, dir, data: data.toString("base64") }) + "\n");
  };

  const ssh = new SSHClient();
  let ttlTimer: NodeJS.Timeout | undefined;

  ssh.on("ready", () => {
    ssh.shell({ term: "xterm-256color", cols: 80, rows: 24 }, (err, stream) => {
      if (err || browserSocket.readyState !== WebSocket.OPEN) {
        ssh.end();
        return;
      }
      logAudit(payload.sub, "session_start", target.id, `resource=${target.hostname} type=ssh-direct login=${target.username} sessionId=${sessionId}`);

      const terminate = () => {
        stream.end();
        ssh.end();
        if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(4008, "session terminated");
      };
      otherSessions.set(sessionId, {
        id: sessionId,
        username: payload.sub,
        resourceId: target.id,
        resourceHostname: target.hostname,
        type: "ssh-direct",
        startedAt,
        terminate,
      });

      const ttlMinutes = effectiveSessionTTLMinutes(roles);
      if (ttlMinutes !== null) {
        ttlTimer = setTimeout(() => {
          logAudit(payload.sub, "session_ttl_expired", target.id, `sessionId=${sessionId} ttlMinutes=${ttlMinutes}`);
          terminate();
        }, ttlMinutes * 60_000);
      }

      stream.on("data", (chunk: Buffer) => {
        record("o", chunk);
        if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(chunk);
        broadcastToSpectators(sessionId, chunk);
      });
      stream.on("close", () => {
        if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close();
      });

      browserSocket.on("message", (data, isBinary) => {
        if (isBinary) {
          record("i", data as Buffer);
          stream.write(data as Buffer);
        } else {
          const msg = JSON.parse(data.toString());
          if (msg.type === "resize") stream.setWindow(msg.rows, msg.cols, 0, 0);
        }
      });

      browserSocket.on("close", () => {
        if (ttlTimer) clearTimeout(ttlTimer);
        recordingStream.end();
        stream.end();
        ssh.end();
        otherSessions.delete(sessionId);
        logAudit(payload.sub, "session_end", target.id, `resource=${target.hostname} sessionId=${sessionId}`);
      });
    });
  });
  // See sshClientFor's comment above — same PAM/keyboard-interactive gotcha applies here.
  ssh.on("keyboard-interactive", (_name, _instructions, _lang, _prompts, finish) => finish([target.password]));
  ssh.on("error", (err) => {
    console.error("[ssh-direct] connect failed:", err);
    logAudit(payload.sub, "session_error", resourceId, `ssh connect failed: ${err.message}`);
    // Surface the real reason (wrong password, ECONNREFUSED, timeout, ...)
    // instead of a generic message — this is exactly what was invisible
    // before, showing only "[session closed]" with no explanation.
    if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(1011, err.message.slice(0, 120));
  });
  const { revoke, ...connectOpts } = sshAuthConfig(target);
  if (revoke) ssh.on("close", revoke);
  ssh.connect({ ...connectOpts, tryKeyboard: true, readyTimeout: 10000 });
});

// ---------- WebSocket: browser sessions (Kubernetes pod exec) ----------
// Uses the real `pods/exec` subresource over the same SPDY-over-WebSocket
// protocol `kubectl exec` itself speaks (via @kubernetes/client-node's
// Exec class) — not a shell-out to a `kubectl` binary. One Connection is
// one specific pod+container, matching how ssh-direct/rdp/database each
// target one pre-configured resource, not a general kubectl-proxy that
// could reach anything the stored credential can see.

// Writable stdout sink that also satisfies @kubernetes/client-node's
// isResizable() check (needs `rows`/`columns` properties + an EventEmitter
// `.on()`, which Writable already provides) so a real PTY resize can be
// forwarded into the exec session's resize channel, not just the initial size.
class K8sTerminalSink extends Writable {
  rows = 24;
  columns = 80;
  constructor(private onChunk: (chunk: Buffer) => void) {
    super();
  }
  override _write(chunk: Buffer, _enc: string, callback: (error?: Error | null) => void) {
    this.onChunk(chunk);
    callback();
  }
  resize(rows: number, cols: number) {
    this.rows = rows;
    this.columns = cols;
    this.emit("resize");
  }
}

const k8sWss = new WebSocketServer({ noServer: true });

k8sWss.on("connection", async (browserSocket, req) => {
  const url = new URL(req.url ?? "", "http://internal");
  const token = url.searchParams.get("token");
  const resourceId = url.searchParams.get("resourceId");
  const clientIp = req.socket.remoteAddress ?? "";

  const payload = token ? verifyTokenLive(token) : null;
  if (!payload || !resourceId) {
    browserSocket.close(4001, "unauthorized");
    return;
  }

  const roles = resolveRoles(payload.roles);
  const auth = authorizeConnectionSession(roles, resourceId, "kubernetes", payload.sub);
  if (!auth.ok) {
    logAudit(payload.sub, "access_denied", resourceId, auth.reason);
    browserSocket.close(4003, auth.reason);
    return;
  }
  if (!ipAllowed(roles, clientIp)) {
    const ipReason = `source ip ${clientIp} outside role's allowed CIDRs`;
    logAudit(payload.sub, "access_denied", resourceId, ipReason);
    browserSocket.close(4003, ipReason);
    return;
  }
  const target = auth.conn;

  if (!target.kubeconfig || !target.k8sNamespace || !target.k8sPodName) {
    logAudit(payload.sub, "session_error", resourceId, "connection missing kubeconfig/namespace/pod");
    browserSocket.close(1011, "connection is not fully configured (missing kubeconfig, namespace, or pod)");
    return;
  }

  const sessionId = crypto.randomUUID();
  const recordingStream = startRecording(sessionId);
  const startedAt = Date.now();
  const record = (dir: "i" | "o", data: Buffer) => {
    recordingStream.write(JSON.stringify({ t: Date.now() - startedAt, dir, data: data.toString("base64") }) + "\n");
  };

  let kubeConfig: KubeConfig;
  try {
    kubeConfig = new KubeConfig();
    kubeConfig.loadFromString(Buffer.from(target.kubeconfig, "base64").toString("utf8"));
  } catch (err) {
    logAudit(payload.sub, "session_error", resourceId, `invalid kubeconfig: ${(err as Error).message}`);
    browserSocket.close(1011, "invalid kubeconfig");
    return;
  }

  const stdoutSink = new K8sTerminalSink((chunk) => {
    record("o", chunk);
    if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(chunk);
    broadcastToSpectators(sessionId, chunk);
  });
  const stderrSink = new K8sTerminalSink((chunk) => {
    record("o", chunk);
    if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(chunk);
    broadcastToSpectators(sessionId, chunk);
  });
  const stdin = new PassThrough();

  let ttlTimer: NodeJS.Timeout | undefined;
  let execSocket: import("ws").WebSocket | undefined;

  // Both the k8s exec stream ending (statusCallback) and the browser tab
  // closing (browserSocket "close") independently lead to session teardown
  // — guard so "session_end" is logged exactly once regardless of which
  // side triggers it first, instead of double-logging or, worse, never
  // logging it if the path that used to log it doesn't fire.
  let sessionEndLogged = false;
  const logSessionEnd = (extra: string) => {
    if (sessionEndLogged) return;
    sessionEndLogged = true;
    logAudit(payload.sub, "session_end", target.id, `resource=${target.hostname} sessionId=${sessionId} ${extra}`);
  };

  const terminate = () => {
    if (ttlTimer) clearTimeout(ttlTimer);
    stdin.end();
    execSocket?.close();
    if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(4008, "session terminated");
  };

  try {
    const exec = new Exec(kubeConfig);
    execSocket = await exec.exec(
      target.k8sNamespace,
      target.k8sPodName,
      target.k8sContainerName || "",
      ["/bin/sh"],
      stdoutSink,
      stderrSink,
      stdin,
      true,
      (status) => logSessionEnd(`status=${status.status ?? "unknown"}`)
    );
  } catch (err) {
    logAudit(payload.sub, "session_error", resourceId, `k8s exec failed: ${(err as Error).message}`);
    if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(1011, (err as Error).message.slice(0, 120));
    return;
  }

  if (browserSocket.readyState !== WebSocket.OPEN) {
    terminate();
    return;
  }

  logAudit(
    payload.sub,
    "session_start",
    target.id,
    `resource=${target.hostname} type=kubernetes login=${target.k8sNamespace}/${target.k8sPodName} sessionId=${sessionId}`
  );

  otherSessions.set(sessionId, {
    id: sessionId,
    username: payload.sub,
    resourceId: target.id,
    resourceHostname: target.hostname,
    type: "kubernetes",
    startedAt,
    terminate,
  });

  const ttlMinutes = effectiveSessionTTLMinutes(roles);
  if (ttlMinutes !== null) {
    ttlTimer = setTimeout(() => {
      logAudit(payload.sub, "session_ttl_expired", target.id, `sessionId=${sessionId} ttlMinutes=${ttlMinutes}`);
      terminate();
    }, ttlMinutes * 60_000);
  }

  execSocket.on("close", () => {
    if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close();
  });

  browserSocket.on("message", (data, isBinary) => {
    if (isBinary) {
      record("i", data as Buffer);
      stdin.write(data as Buffer);
    } else {
      const msg = JSON.parse(data.toString());
      if (msg.type === "resize") stdoutSink.resize(msg.rows, msg.cols);
    }
  });

  browserSocket.on("close", () => {
    if (ttlTimer) clearTimeout(ttlTimer);
    recordingStream.end();
    stdin.end();
    execSocket?.close();
    otherSessions.delete(sessionId);
    logSessionEnd("(browser disconnected)");
  });
});

// ---------- WebSocket: browser sessions (database query console) ----------

const dbWss = new WebSocketServer({ noServer: true });

dbWss.on("connection", async (browserSocket, req) => {
  const url = new URL(req.url ?? "", "http://internal");
  const token = url.searchParams.get("token");
  const resourceId = url.searchParams.get("resourceId");
  const clientIp = req.socket.remoteAddress ?? "";

  const payload = token ? verifyTokenLive(token) : null;
  if (!payload || !resourceId) {
    browserSocket.close(4001, "unauthorized");
    return;
  }

  // Live roles, not the JWT's login-time snapshot — same reasoning as
  // requireAuth in auth.ts: a role grant/revoke must take effect on the
  // very next connection attempt, not only after a fresh login.
  const roles = resolveRoles(payload.roles);
  const auth = authorizeConnectionSession(roles, resourceId, "database", payload.sub);
  if (!auth.ok) {
    logAudit(payload.sub, "access_denied", resourceId, auth.reason);
    browserSocket.close(4003, auth.reason);
    return;
  }
  if (!ipAllowed(roles, clientIp)) {
    const ipReason = `source ip ${clientIp} outside role's allowed CIDRs`;
    logAudit(payload.sub, "access_denied", resourceId, ipReason);
    browserSocket.close(4003, ipReason);
    return;
  }
  const target = auth.conn;

  const client = createDbClient(target.dbEngine ?? "postgres", {
    host: target.host,
    port: target.port,
    user: target.username,
    password: target.password,
    database: target.databaseName || undefined,
    connectTimeoutMs: 10000,
  });

  let ttlTimer: NodeJS.Timeout | undefined;
  try {
    await client.connect();
  } catch (err) {
    logAudit(payload.sub, "session_error", resourceId, `db connect failed: ${(err as Error).message}`);
    browserSocket.close(1011, (err as Error).message.slice(0, 120));
    return;
  }

  const sessionId = crypto.randomUUID();
  logAudit(payload.sub, "session_start", target.id, `resource=${target.hostname} type=database engine=${target.dbEngine ?? "postgres"} login=${target.username} sessionId=${sessionId}`);
  browserSocket.send(JSON.stringify({ type: "connected", database: target.databaseName }));

  // Recorded as the same {t, dir, data} jsonl format every other session
  // type uses — "o" frames are the query/result/error JSON messages
  // (base64'd like everything else, even though it's already text, so the
  // frame format is identical across all four session types and Replay.tsx
  // doesn't need a special case to decode it). This is real replay, not
  // just the per-query audit-log text that existed before — the audit log
  // still gets that too, for the compliance-search use case, but now the
  // full session (queries AND their actual results) can be played back.
  const recordingStream = startRecording(sessionId);
  const startedAt = Date.now();
  const record = (frame: Record<string, unknown>) => {
    recordingStream.write(JSON.stringify({ t: Date.now() - startedAt, dir: "o", data: Buffer.from(JSON.stringify(frame)).toString("base64") }) + "\n");
  };

  const terminate = () => {
    client.end();
    if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(4008, "session terminated");
  };
  otherSessions.set(sessionId, {
    id: sessionId,
    username: payload.sub,
    resourceId: target.id,
    resourceHostname: target.hostname,
    type: "database",
    startedAt,
    terminate,
  });

  const ttlMinutes = effectiveSessionTTLMinutes(roles);
  if (ttlMinutes !== null) {
    ttlTimer = setTimeout(() => {
      logAudit(payload.sub, "session_ttl_expired", target.id, `ttlMinutes=${ttlMinutes} sessionId=${sessionId}`);
      terminate();
    }, ttlMinutes * 60_000);
  }

  browserSocket.on("message", async (data) => {
    let msg: { type: string; sql?: string };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type !== "query" || !msg.sql) return;
    // Every query is audited by text — this is exactly "database query
    // recording" from the original feature list, just without full
    // byte-for-byte session replay like SSH gets.
    logAudit(payload.sub, "db_query", target.id, msg.sql.slice(0, 500));
    const queryMsg = { type: "query", sql: msg.sql };
    broadcastToSpectators(sessionId, JSON.stringify(queryMsg));
    record(queryMsg);
    try {
      const result = await client.query(msg.sql);
      const resultPayload = {
        type: "result",
        columns: result.columns,
        rows: result.rows,
        rowCount: result.rowCount,
      };
      const resultMsg = JSON.stringify(resultPayload);
      browserSocket.send(resultMsg);
      broadcastToSpectators(sessionId, resultMsg);
      record(resultPayload);
    } catch (err) {
      const errorPayload = { type: "error", message: (err as Error).message };
      const errMsg = JSON.stringify(errorPayload);
      browserSocket.send(errMsg);
      broadcastToSpectators(sessionId, errMsg);
      record(errorPayload);
    }
  });

  browserSocket.on("close", () => {
    if (ttlTimer) clearTimeout(ttlTimer);
    recordingStream.end();
    client.end();
    otherSessions.delete(sessionId);
    logAudit(payload.sub, "session_end", target.id, `resource=${target.hostname} type=database sessionId=${sessionId}`);
  });
});

// ---------- WebSocket: admin session co-watching (view-only) ----------

const watchWss = new WebSocketServer({ noServer: true });

watchWss.on("connection", (browserSocket, req) => {
  const url = new URL(req.url ?? "", "http://internal");
  const token = url.searchParams.get("token");
  const sessionId = url.searchParams.get("sessionId");
  const payload = token ? verifyTokenLive(token) : null;
  if (!payload || !sessionId) {
    browserSocket.close(4001, "unauthorized");
    return;
  }

  // Live roles, not the JWT's login-time snapshot — same reasoning as
  // requireAuth in auth.ts: a role grant/revoke must take effect on the
  // very next connection attempt, not only after a fresh login.
  const roles = resolveRoles(payload.roles);
  const isDelegated = roles.some((r) => Object.keys(r.manageLabels).length > 0);
  if (!isFullAdmin(roles) && !isDelegated) {
    browserSocket.close(4003, "admin only");
    return;
  }

  const agentSession = sessions.get(sessionId);
  const otherSession = otherSessions.get(sessionId);
  if (!agentSession && !otherSession) {
    browserSocket.close(4004, "session not found — it may have already ended");
    return;
  }
  const resourceId = agentSession?.agentId ?? otherSession!.resourceId;
  const type = agentSession ? "ssh-agent" : otherSession!.type;
  if (!isFullAdmin(roles) && !canManageResource(roles, resourceLabelsFor(resourceId))) {
    logAudit(payload.sub, "access_denied", resourceId, "watch: resource outside managed scope");
    browserSocket.close(4003, "resource outside your managed scope");
    return;
  }

  addSpectator(sessionId, browserSocket);
  browserSocket.send(JSON.stringify({ type: "watch-info", sessionType: type, resourceId }));
  logAudit(payload.sub, "session_watched", resourceId, `sessionId=${sessionId}`);

  // Spectators are read-only by design — anything they send is dropped,
  // never forwarded into the real session. Enforcing that server-side
  // (not just "the UI doesn't have an input box") is what actually makes
  // this view-only rather than merely presented as such.
  browserSocket.on("message", () => {});

  browserSocket.on("close", () => {
    removeSpectator(sessionId, browserSocket);
  });
});

// Diagram Editor presence + save notifications — see the comment on
// diagramViewers in state.ts for what this deliberately is and isn't
// (no live co-editing, just "who else is here" + "reload, someone saved").
const diagramCollabWss = new WebSocketServer({ noServer: true });

diagramCollabWss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", "http://internal");
  const token = url.searchParams.get("token");
  const diagramId = url.searchParams.get("diagramId");
  const payload = token ? verifyTokenLive(token) : null;
  if (!payload || !diagramId) {
    ws.close(4001, "unauthorized");
    return;
  }

  const roles = resolveRoles(payload.roles);
  if (!isAnyAdmin(roles)) {
    ws.close(4003, "admin only");
    return;
  }

  addDiagramViewer(diagramId, ws, payload.sub);
  const presence = { type: "presence", viewers: listDiagramViewerNames(diagramId) };
  broadcastToDiagramViewers(diagramId, presence);

  // Spectator-style: this channel is presence + notifications only, never
  // a path for one client's edits to reach another's canvas.
  ws.on("message", () => {});

  ws.on("close", () => {
    removeDiagramViewer(diagramId, ws);
    broadcastToDiagramViewers(diagramId, { type: "presence", viewers: listDiagramViewerNames(diagramId) });
  });
});

// ---------- route upgrades to the right WSS by path ----------

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "", "http://internal");
  if (pathname === "/agent") {
    agentWss.handleUpgrade(req, socket, head, (ws) => agentWss.emit("connection", ws, req));
  } else if (pathname === "/session") {
    sessionWss.handleUpgrade(req, socket, head, (ws) => sessionWss.emit("connection", ws, req));
  } else if (pathname === "/rdp-session") {
    rdpWss.handleUpgrade(req, socket, head, (ws) => rdpWss.emit("connection", ws, req));
  } else if (pathname === "/vnc-session") {
    vncWss.handleUpgrade(req, socket, head, (ws) => vncWss.emit("connection", ws, req));
  } else if (pathname === "/ssh-direct-session") {
    sshDirectWss.handleUpgrade(req, socket, head, (ws) => sshDirectWss.emit("connection", ws, req));
  } else if (pathname === "/db-session") {
    dbWss.handleUpgrade(req, socket, head, (ws) => dbWss.emit("connection", ws, req));
  } else if (pathname === "/k8s-session") {
    k8sWss.handleUpgrade(req, socket, head, (ws) => k8sWss.emit("connection", ws, req));
  } else if (pathname === "/watch-session") {
    watchWss.handleUpgrade(req, socket, head, (ws) => watchWss.emit("connection", ws, req));
  } else if (pathname === "/diagram-collab") {
    diagramCollabWss.handleUpgrade(req, socket, head, (ws) => diagramCollabWss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

initSiemExport();
initPluginSystem();

// Fires only on an actual status transition (up->down or down->up), never
// on every check — matches the semantics of every other audit/notification
// event in this app, which record state changes, not polling noise.
function onMonitorStatusChange(monitor: Monitor, previousStatus: Monitor["status"], check: { message: string }) {
  const eventType = monitor.status === "down" ? "monitor_down" : "monitor_up";
  logAudit("system", eventType, monitor.id, `${monitor.name}: ${previousStatus} -> ${monitor.status} (${check.message})`);
  sendAlertEmail(
    `[Remotely] ${monitor.name} is ${monitor.status === "down" ? "DOWN" : "back UP"}`,
    `Monitor: ${monitor.name}\nType: ${monitor.type}\nStatus: ${previousStatus} -> ${monitor.status}\nDetail: ${check.message}\nTime: ${new Date().toLocaleString()}`
  ).catch(() => {});
}

startMonitorScheduler(onMonitorStatusChange);

// Infrastructure discovery & diagram routes
import { infraRouter } from "./infraRoutes.js";
app.use("/api/infra", infraRouter);

// Public, unauthenticated diagram view — deliberately outside infraRouter's
// requireAuth/requireAnyAdmin gate. Reachable only by knowing the random
// share token (see diagramStore.ts's generateShareToken); returns a
// minimal read-only payload, never the full admin diagram object.
import { getDiagramByShareToken } from "./diagramStore.js";
app.get("/api/public/diagrams/:token", (req, res) => {
  const diagram = getDiagramByShareToken(req.params.token);
  if (!diagram) {
    res.status(404).json({ error: "This share link is invalid or has been revoked." });
    return;
  }
  res.json({ name: diagram.name, nodes: diagram.nodes, edges: diagram.edges, updatedAt: diagram.updatedAt });
});

// Every one of these has a hardcoded fallback (JWT_SECRET in auth.ts,
// AGENT_JOIN_TOKEN and SSH_JIT_INTERNAL_TOKEN above) so the demo/dev
// experience works with zero setup — but those fallback values are public
// (they're sitting right here in the open-source source), so a real
// deployment that leaves any of them unset is signing session tokens and
// authorizing agent/JIT-SSH access with a secret anyone can read on
// GitHub. This can't safely be a hard refuse-to-boot (would break the
// demo/dev workflow this whole project is built around), so it's a
// warning too loud to miss instead.
function warnAboutUnsetSecrets() {
  const unset: string[] = [];
  if (!process.env.JWT_SECRET) unset.push("JWT_SECRET");
  if (!process.env.AGENT_JOIN_TOKEN) unset.push("AGENT_JOIN_TOKEN");
  if (!process.env.SSH_JIT_INTERNAL_TOKEN) unset.push("SSH_JIT_INTERNAL_TOKEN");
  if (unset.length === 0) return;
  const border = "!".repeat(78);
  console.warn(`\n${border}`);
  console.warn("! SECURITY WARNING: using publicly-known default values for:");
  for (const name of unset) console.warn(`!   - ${name}`);
  console.warn("! These defaults are visible in this project's public source code.");
  console.warn("! Fine for local development — DO NOT leave them unset on any");
  console.warn("! deployment reachable by anyone other than you. Set real random");
  console.warn("! values for all of the above before exposing this control plane.");
  console.warn(`${border}\n`);
}

// ─── Moderated Sessions API ──────────────────────────────────────────────────
import { listPendingModeratedSessions } from "./moderatedSessions.js";
app.get("/api/admin/moderated-sessions", requireAuth, requireAdmin, (_req, res) => {
  res.json(listPendingModeratedSessions());
});

// ─── Slack Integration API ───────────────────────────────────────────────────
import { getSlackConfig, setSlackConfig, verifySlackSignature, handleSlackInteraction } from "./slackApproval.js";
app.get("/api/admin/integrations/slack", requireAuth, requireAdmin, (_req, res) => {
  const config = getSlackConfig();
  res.json(config ? { enabled: config.enabled, channelId: config.channelId, approvalTtlMinutes: config.approvalTtlMinutes, configured: true } : { enabled: false, configured: false });
});
app.post("/api/admin/integrations/slack", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const { enabled, botToken, signingSecret, channelId, approvalTtlMinutes } = req.body;
  setSlackConfig({ enabled: enabled !== false, botToken: botToken || "", signingSecret: signingSecret || "", channelId: channelId || "", approvalTtlMinutes: approvalTtlMinutes || 60 });
  logAudit(req.user!.sub, "slack_config_updated", null, `Slack integration ${enabled ? "enabled" : "disabled"}`);
  res.json({ ok: true });
});
// Slack interaction callback (buttons clicked) — no auth (Slack signs it)
app.post("/api/integrations/slack/interact", express.urlencoded({ extended: true }), (req, res) => {
  const signature = req.headers["x-slack-signature"] as string || "";
  const timestamp = req.headers["x-slack-request-timestamp"] as string || "";
  const rawBody = typeof req.body.payload === "string" ? req.body.payload : JSON.stringify(req.body);
  if (!verifySlackSignature(signature, timestamp, rawBody)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }
  const payload = JSON.parse(typeof req.body.payload === "string" ? req.body.payload : JSON.stringify(req.body));
  const result = handleSlackInteraction(payload);
  res.json(result);
});

// ─── ChatOps (PagerDuty/Teams/Discord) Config API ────────────────────────────
import { getPagerDutyConfig, setPagerDutyConfig, getTeamsConfig, setTeamsConfig, getDiscordConfig, setDiscordConfig } from "./chatOpsIntegrations.js";
app.get("/api/admin/integrations/chatops", requireAuth, requireAdmin, (_req, res) => {
  res.json({ pagerduty: getPagerDutyConfig(), teams: getTeamsConfig(), discord: getDiscordConfig() });
});
app.post("/api/admin/integrations/pagerduty", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  setPagerDutyConfig(req.body);
  logAudit(req.user!.sub, "pagerduty_config_updated", null, `PagerDuty ${req.body.enabled ? "enabled" : "disabled"}`);
  res.json({ ok: true });
});
app.post("/api/admin/integrations/teams", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  setTeamsConfig(req.body);
  logAudit(req.user!.sub, "teams_config_updated", null, `Teams ${req.body.enabled ? "enabled" : "disabled"}`);
  res.json({ ok: true });
});
app.post("/api/admin/integrations/discord", requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  setDiscordConfig(req.body);
  logAudit(req.user!.sub, "discord_config_updated", null, `Discord ${req.body.enabled ? "enabled" : "disabled"}`);
  res.json({ ok: true });
});

// ─── Passwordless Login API ──────────────────────────────────────────────────
import { getPasswordlessAuthOptions, verifyPasswordlessAuth } from "./passwordless.js";
app.post("/api/login/passwordless/options", async (_req, res) => {
  try {
    const { sessionId, options } = await getPasswordlessAuthOptions();
    res.json({ sessionId, options });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
app.post("/api/login/passwordless/verify", async (req, res) => {
  const { sessionId, response } = req.body;
  if (!sessionId || !response) { res.status(400).json({ error: "sessionId and response required" }); return; }
  const result = await verifyPasswordlessAuth(sessionId, response);
  if ("error" in result) { res.status(401).json({ error: result.error }); return; }
  const token = signToken({ sub: result.user.username, roles: result.user.roles });
  logAudit(result.user.username, "login", null, "passwordless (passkey)");
  const flags = adminFlags(result.user.roles);
  res.json({ token, username: result.user.username, roles: result.user.roles, ...flags });
});

// ─── Kubernetes Cluster Browsing API ─────────────────────────────────────────
import { loadKubeConfig, listNamespaces, listPods, listDeployments, listServices, getPodLogs, getClusterInfo } from "./k8sClusterAccess.js";
app.get("/api/k8s/:connectionId/info", requireAuth, (req: AuthedRequest, res) => {
  const conn = getConnection(req.params.connectionId);
  if (!conn || conn.type !== "kubernetes") { res.status(404).json({ error: "Kubernetes connection not found" }); return; }
  try {
    const kc = loadKubeConfig(conn, req.user!.sub);
    getClusterInfo(kc, conn).then((info) => res.json(info)).catch((e) => res.status(500).json({ error: (e as Error).message }));
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});
app.get("/api/k8s/:connectionId/namespaces", requireAuth, (req: AuthedRequest, res) => {
  const conn = getConnection(req.params.connectionId);
  if (!conn || conn.type !== "kubernetes") { res.status(404).json({ error: "Not found" }); return; }
  const kc = loadKubeConfig(conn, req.user!.sub);
  listNamespaces(kc).then((ns) => res.json(ns)).catch((e) => res.status(500).json({ error: (e as Error).message }));
});
app.get("/api/k8s/:connectionId/pods", requireAuth, (req: AuthedRequest, res) => {
  const conn = getConnection(req.params.connectionId);
  if (!conn || conn.type !== "kubernetes") { res.status(404).json({ error: "Not found" }); return; }
  const kc = loadKubeConfig(conn, req.user!.sub);
  const ns = req.query.namespace as string | undefined;
  listPods(kc, ns).then((pods) => res.json(pods)).catch((e) => res.status(500).json({ error: (e as Error).message }));
});
app.get("/api/k8s/:connectionId/deployments", requireAuth, (req: AuthedRequest, res) => {
  const conn = getConnection(req.params.connectionId);
  if (!conn || conn.type !== "kubernetes") { res.status(404).json({ error: "Not found" }); return; }
  const kc = loadKubeConfig(conn, req.user!.sub);
  const ns = req.query.namespace as string || "default";
  listDeployments(kc, ns).then((deps) => res.json(deps)).catch((e) => res.status(500).json({ error: (e as Error).message }));
});
app.get("/api/k8s/:connectionId/services", requireAuth, (req: AuthedRequest, res) => {
  const conn = getConnection(req.params.connectionId);
  if (!conn || conn.type !== "kubernetes") { res.status(404).json({ error: "Not found" }); return; }
  const kc = loadKubeConfig(conn, req.user!.sub);
  const ns = req.query.namespace as string || "default";
  listServices(kc, ns).then((svcs) => res.json(svcs)).catch((e) => res.status(500).json({ error: (e as Error).message }));
});
app.get("/api/k8s/:connectionId/pods/:podName/logs", requireAuth, (req: AuthedRequest, res) => {
  const conn = getConnection(req.params.connectionId);
  if (!conn || conn.type !== "kubernetes") { res.status(404).json({ error: "Not found" }); return; }
  const kc = loadKubeConfig(conn, req.user!.sub);
  const ns = req.query.namespace as string || "default";
  const container = req.query.container as string | undefined;
  const tail = Number(req.query.tail) || 100;
  getPodLogs(kc, ns, req.params.podName, container, tail)
    .then((logs) => res.json({ logs }))
    .catch((e) => res.status(500).json({ error: (e as Error).message }));
});

server.listen(PORT, () => {
  console.log(`Remotely control plane listening on :${PORT}`);
  warnAboutUnsetSecrets();
});
