/**
 * Compliance reporting — evaluates a real, concrete set of SOC2-style
 * Trust Services Criteria controls against actual system state, not a
 * static checklist someone fills in by hand.
 *
 * Every control here is either:
 *  (a) COMPUTED from real data (users, roles, the audit log, SIEM config,
 *      the recordings directory) with an honest pass/warn/fail threshold, or
 *  (b) STRUCTURAL — a guarantee the code itself enforces (e.g. "deny
 *      always wins over allow"), cited with the exact file/function that
 *      enforces it, paired with a real usage metric where one exists so
 *      it isn't just an unverifiable claim.
 *
 * What this deliberately does NOT do: invent a control that can't actually
 * be checked (e.g. "encryption at rest" — this POC's SQLite file isn't
 * encrypted, so claiming that control would be fabricating evidence,
 * which defeats the entire point of a compliance report).
 */

import fs from "node:fs";
import { listUsers, listRoles, readAudit, getSiemConfig } from "./store.js";
import { RECORDINGS_DIR } from "./state.js";
import { isAnyAdmin, resolveRoles } from "./rbac.js";

export type ControlStatus = "pass" | "warn" | "fail" | "info";

export interface ComplianceControl {
  id: string;
  category: string;
  title: string;
  description: string;
  kind: "computed" | "structural";
  status: ControlStatus;
  detail: string;
  // For structural controls: where in the code this is actually enforced,
  // so "trust us" isn't the only thing backing the claim.
  enforcedBy?: string;
}

export interface ComplianceReport {
  generatedAt: number;
  controls: ComplianceControl[];
  summary: { pass: number; warn: number; fail: number; info: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function getComplianceReport(): ComplianceReport {
  const users = listUsers();
  const roles = listRoles();
  const events = readAudit(100_000); // effectively "all" — see readAudit's default-limit signature
  const now = Date.now();

  const controls: ComplianceControl[] = [];

  // ─── CC6: Logical Access Controls ────────────────────────────────────

  const privilegedUsers = users.filter((u) => isAnyAdmin(resolveRoles(u.roles)));
  const privilegedWithMfaOrPasskey = privilegedUsers.filter(
    (u) => u.mfaEnabled || (u.webauthnCredentials && u.webauthnCredentials.length > 0)
  );
  const mfaAdoptionPct = privilegedUsers.length === 0 ? 100 : Math.round((privilegedWithMfaOrPasskey.length / privilegedUsers.length) * 100);
  controls.push({
    id: "cc6.1-mfa-privileged",
    category: "CC6 — Logical Access Controls",
    title: "MFA/passkey adoption among privileged accounts",
    description: "Every full-admin or delegated-admin account should have a second factor enabled, since a compromised password alone shouldn't be enough to reach admin capability.",
    kind: "computed",
    status: mfaAdoptionPct === 100 ? "pass" : mfaAdoptionPct >= 50 ? "warn" : "fail",
    detail: `${privilegedWithMfaOrPasskey.length}/${privilegedUsers.length} privileged accounts (${mfaAdoptionPct}%) have MFA or a passkey enabled.`,
  });

  const roleTtlUnlimited = roles.filter((r) => !r.maxSessionTTLMinutes || r.maxSessionTTLMinutes === 0);
  controls.push({
    id: "cc6.1-session-ttl",
    category: "CC6 — Logical Access Controls",
    title: "Session TTLs are bounded",
    description: "Roles without a maximum session TTL allow a session to stay open indefinitely, which widens the window a hijacked or forgotten session can be abused in.",
    kind: "computed",
    status: roleTtlUnlimited.length === 0 ? "pass" : "warn",
    detail: roleTtlUnlimited.length === 0
      ? `All ${roles.length} roles have a bounded session TTL.`
      : `${roleTtlUnlimited.length}/${roles.length} role(s) have no session TTL limit: ${roleTtlUnlimited.map((r) => r.name).join(", ")}.`,
  });

  controls.push({
    id: "cc6.1-deny-wins",
    category: "CC6 — Logical Access Controls",
    title: "Explicit deny always overrides allow",
    description: "A role's deny-label rules must block access even when an allow rule or a direct per-user assignment would otherwise grant it — an admin blocking something should never be silently overridden.",
    kind: "structural",
    status: "pass",
    detail: "Enforced unconditionally in canAccessResource() — deny rules are checked after and independently of allow/assignment, with no bypass path.",
    enforcedBy: "control-plane/src/rbac.ts:canAccessResource",
  });

  const staleThreshold = now - 90 * DAY_MS;
  const lastLoginByUser = new Map<string, number>();
  for (const e of events) {
    if (e.eventType === "login") {
      const prev = lastLoginByUser.get(e.username) ?? 0;
      if (e.ts > prev) lastLoginByUser.set(e.username, e.ts);
    }
  }
  const staleAccounts = users.filter((u) => {
    const last = lastLoginByUser.get(u.username);
    return last === undefined || last < staleThreshold;
  });
  controls.push({
    id: "cc6.2-stale-accounts",
    category: "CC6 — Logical Access Controls",
    title: "No stale accounts (90+ days without a login)",
    description: "Accounts that haven't authenticated in 90+ days (or ever) are candidates for de-provisioning — every one still holds whatever access its roles grant.",
    kind: "computed",
    status: staleAccounts.length === 0 ? "pass" : staleAccounts.length <= 2 ? "warn" : "fail",
    detail: staleAccounts.length === 0
      ? "Every account has logged in within the last 90 days."
      : `${staleAccounts.length} account(s) with no login in 90+ days (or never): ${staleAccounts.map((u) => u.username).join(", ")}.`,
  });

  const breakGlassEvents = events.filter((e) => e.eventType === "access_request_break_glass" && e.ts > now - 30 * DAY_MS);
  controls.push({
    id: "cc6.3-break-glass-audit",
    category: "CC6 — Logical Access Controls",
    title: "Break-glass access is scoped and fully audited",
    description: "Emergency self-approved access must require an explicit eligible role (not available to everyone) and must leave a distinct, searchable audit trail — never indistinguishable from a normal admin-approved grant.",
    kind: "structural",
    status: "pass",
    detail: `Requires Role.breakGlassEligible and logs a distinct access_request_break_glass event. ${breakGlassEvents.length} break-glass grant(s) used in the last 30 days.`,
    enforcedBy: "control-plane/src/index.ts (POST /api/access-requests, breakGlass branch)",
  });

  const loginStatusEvents = events.filter((e) => e.eventType === "session_login_status" && e.ts > now - 30 * DAY_MS);
  const impersonatedCount = loginStatusEvents.filter((e) => /impersonated=true/.test(e.details)).length;
  const fellBackCount = loginStatusEvents.length - impersonatedCount;
  controls.push({
    id: "cc6.1-os-impersonation",
    category: "CC6 — Logical Access Controls",
    title: "ssh-agent sessions run as the actual requested OS login",
    description: "A session approved for login \"alice\" should actually run as the OS user alice, not silently as whatever user the agent process itself happens to run as — otherwise an RBAC allow decision doesn't mean what it appears to mean.",
    kind: loginStatusEvents.length > 0 ? "computed" : "structural",
    status: loginStatusEvents.length === 0 ? "info" : fellBackCount === 0 ? "pass" : "warn",
    detail:
      loginStatusEvents.length === 0
        ? "No ssh-agent sessions in the last 30 days to evaluate. When they occur, each agent reports whether it actually impersonated the requested login (uid/gid switch) or fell back to its own user — see session_login_status events."
        : `${impersonatedCount}/${loginStatusEvents.length} session(s) in the last 30 days actually ran as the requested OS login (EUID/EGID genuinely switched). ${fellBackCount} fell back to the agent's own user (requires the agent to run as root with a matching target OS user). Known residual gap even when impersonated: node-pty's native addon sets uid/gid but never resets supplementary groups, so the shell keeps the agent's own group memberships (e.g. group 0 if the agent runs as root) — see agent/src/impersonate.ts.`,
    enforcedBy: "agent/src/impersonate.ts (resolveUser/canImpersonate), wired into the \"open\" handler in agent/src/index.ts",
  });

  // ─── CC7: System Monitoring ──────────────────────────────────────────

  const oldestEvent = events.length > 0 ? Math.min(...events.map((e) => e.ts)) : now;
  controls.push({
    id: "cc7.2-audit-log",
    category: "CC7 — System Monitoring",
    title: "Audit logging is active and append-only",
    description: "Every authentication, access decision, and administrative change must be durably logged, and that log must never be editable after the fact.",
    kind: "structural",
    status: events.length > 0 ? "pass" : "info",
    detail: `${events.length} events on record, covering ${Math.max(1, Math.round((now - oldestEvent) / DAY_MS))} day(s). Log file is append-only (fs.appendFileSync, no update/delete path exists).`,
    enforcedBy: "control-plane/src/store.ts:logAudit",
  });

  const siemConfig = getSiemConfig();
  controls.push({
    id: "cc7.2-siem-export",
    category: "CC7 — System Monitoring",
    title: "Audit events are forwarded to an external SIEM",
    description: "Relying solely on logs stored on the same system they describe means an attacker who compromises the system can also erase the evidence. External, real-time forwarding is the mitigation.",
    kind: "computed",
    status: siemConfig?.enabled ? "pass" : "warn",
    detail: siemConfig?.enabled
      ? `Enabled, forwarding to a configured webhook since ${new Date(siemConfig.updatedAt).toLocaleDateString()}.`
      : "Not enabled — audit events only exist locally. Configure this under Admin → SIEM Export.",
  });

  let recordingCount = 0;
  try {
    recordingCount = fs.readdirSync(RECORDINGS_DIR).filter((f) => f.endsWith(".jsonl")).length;
  } catch {
    recordingCount = 0;
  }
  controls.push({
    id: "cc7.2-session-recording",
    category: "CC7 — System Monitoring",
    title: "Interactive sessions are recorded and replayable",
    description: "Every session type (SSH, RDP, database) should produce a byte-for-byte or query-for-query recording an admin can review after the fact, not just a one-line audit entry.",
    kind: "structural",
    status: "pass",
    detail: `All 4 session types (ssh-agent, ssh-direct, rdp, database) write a recording on every session. ${recordingCount} recording(s) currently on disk.`,
    enforcedBy: "control-plane/src/index.ts (startRecording() call in each *Wss.on(\"connection\") handler)",
  });

  // ─── CC8: Change Management ──────────────────────────────────────────

  controls.push({
    id: "cc8.1-attributed-changes",
    category: "CC8 — Change Management",
    title: "Administrative changes are attributed",
    description: "Every user/role/connection/organization mutation must record which authenticated principal made it, not just that it happened.",
    kind: "structural",
    status: "pass",
    detail: "Every admin mutation route calls logAudit(req.user!.sub, ...) with the acting user's identity — none of the create/update/delete routes log anonymously.",
    enforcedBy: "control-plane/src/index.ts (admin CRUD routes)",
  });

  // ─── Credential & data handling ──────────────────────────────────────

  controls.push({
    id: "cred-download-tokens",
    category: "Credential & Data Handling",
    title: "File downloads use short-lived, single-file-scoped tokens",
    description: "A file-download link shouldn't carry a general-purpose, hours-long session credential — a leaked link (browser history, a proxy log, a screenshot) should be useless a minute later and unable to fetch anything but the one file it was minted for.",
    kind: "structural",
    status: "pass",
    detail: "Download tokens are bound to one exact resourceId+path, expire in 60 seconds, and are rejected by a distinct verifier from normal session auth.",
    enforcedBy: "control-plane/src/auth.ts:signDownloadToken / verifyDownloadToken",
  });

  const summary = controls.reduce(
    (acc, c) => {
      acc[c.status]++;
      return acc;
    },
    { pass: 0, warn: 0, fail: 0, info: 0 }
  );

  return { generatedAt: now, controls, summary };
}
