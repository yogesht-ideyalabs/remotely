import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadTable, saveRow, deleteRow, tableIsEmpty } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_LOG_PATH = path.join(__dirname, "..", "audit.jsonl");

export interface Role {
  name: string;
  description: string;
  // Organizational grouping only (like Connection.folder) — purely for
  // sorting the Roles page into sections, no RBAC significance.
  category: string;
  // key -> allowed values (OR within a key, AND across keys). Empty object
  // is the wildcard/admin case: matches every resource's labels.
  allowLabels: Record<string, string[]>;
  // Same shape; if a resource matches ANY deny rule on ANY of the user's
  // active roles, access is blocked regardless of what any role allows —
  // same "deny always wins" semantics as Teleport.
  denyLabels: Record<string, string[]>;
  // Which resource types this role covers ("ssh-agent" | "ssh-direct" |
  // "rdp" | "database"). Empty = all types.
  resourceTypes: string[];
  // OS/DB/RDP usernames this role may assume on a resource. A session
  // request for a login not in this list is denied even if the resource
  // itself is otherwise visible.
  logins: string[];
  // Auto-disconnect after N minutes. 0/undefined = unlimited.
  maxSessionTTLMinutes: number;
  // CIDRs the connecting client's IP must fall within. Empty = unrestricted.
  allowedCIDRs: string[];
  // ISO date after which this role no longer grants anything. null = never.
  expiresAt: string | null;
  // Delegated/tenant admin scope: if non-empty, a user holding this role
  // can manage (create/edit/delete) users whose `tenant` and connections
  // whose labels match this pattern, via the same admin API a full admin
  // uses — without needing the full "admin" role. Empty = not an admin
  // at all (the common case for a plain access role).
  manageLabels: Record<string, string[]>;
  // RDP-only for now (passed as guacd's disable-copy/disable-paste connect
  // params). false on ANY active role blocks clipboard in both directions
  // for that session — same "most restrictive wins" pattern as CIDR.
  allowClipboard: boolean;
  // Holder can self-approve their own access requests instead of waiting
  // on an admin — "break glass" for genuine emergencies. Every use is
  // still logged like any other grant (see access_request_created /
  // access_request_approved audit events), just without the wait, and
  // defaults to a short expiry. Not the same as broad access — the
  // requester still names one specific resource+login at a time.
  breakGlassEligible: boolean;
  // Moderated sessions: if set, any session this role covers requires
  // a moderator (a user with canModerate=true) to be present live before
  // the session can proceed. The session enters a "pending_moderation"
  // state until the moderator joins via the watch/spectate channel.
  requireSessionModeration?: boolean;
  // If true, this role's holder can act as a moderator for moderated sessions.
  canModerate?: boolean;
}

export interface User {
  username: string;
  passwordHash: string;
  roles: string[];
  // Which organization this user belongs to (an Organization.id below) —
  // used to scope what a delegated admin (see Role.manageLabels) is
  // allowed to manage. Empty string = no org (typically your own MSP
  // staff, e.g. full admins).
  tenant: string;
  createdAt: number;
  // Profile extras — none of this affects RBAC, purely self-service account
  // management (see /api/profile routes).
  avatar?: string; // data: URI, small image, stored inline — fine for a POC, not for a real DB row
  mfaEnabled?: boolean;
  mfaSecret?: string; // base32 TOTP secret; only ever sent to the client during initial setup, never again
  webauthnCredentials?: WebauthnCredentialRecord[];
  // Bumped on any password change (self-service or admin-set) and by the
  // admin "log out everywhere" action. A signed JWT carries the
  // tokenVersion it was issued with; verifyTokenLive (auth.ts) rejects
  // any token whose tokenVersion doesn't match this live value, which is
  // how already-issued tokens get revoked without a server-side session
  // store. Absent (undefined) is treated as 0.
  tokenVersion?: number;
}

export interface WebauthnCredentialRecord {
  id: string; // base64url credential ID, as returned by the authenticator
  publicKeyB64: string; // @simplewebauthn gives a raw Uint8Array; base64 is what's actually JSON/in-memory-store-friendly
  counter: number; // signature counter — bumped on every use, checked for regressions as basic clone detection
  transports?: string[];
  deviceName: string;
  createdAt: number;
}

export interface Organization {
  id: string;
  name: string;
  createdAt: number;
  // White-label branding — shown in the topbar instead of "Remotely" for
  // members of this org. All optional; an org with none set just gets the
  // default look, same as before this existed.
  brandName?: string;
  brandColor?: string; // hex
  logoDataUri?: string;
}

export type ConnectionType = "ssh-direct" | "rdp" | "database" | "kubernetes" | "vnc";

export interface Connection {
  id: string;
  hostname: string;
  type: ConnectionType;
  labels: Record<string, string>;
  folder: string;
  host: string;
  port: number;
  username: string;
  password: string;
  databaseName: string;
  // Direct per-user grants — a user in this list can access the
  // connection even if no role's allowLabels match it. Deny labels on
  // their roles still apply on top of this (see rbac.ts): a direct grant
  // is "shared with you", not an override of an explicit block.
  assignedUsers: string[];
  createdAt: number;
  createdBy: string;
  // ssh-direct only: if set, connect using this stored key's private key
  // instead of `password`. Looked up at connect time (sshAuthFor in
  // index.ts) rather than copied in, so rotating/deleting the key in one
  // place updates every connection that references it.
  sshKeyId?: string;
  // ssh-direct only: if true, takes priority over both sshKeyId and
  // password — every session mints a fresh ephemeral keypair, JIT-grants
  // it for a few minutes via sshd's AuthorizedKeysCommand, and revokes it
  // on disconnect. See sshJit.ts for why this isn't OpenSSH certificates.
  sshJitEnabled?: boolean;
  // kubernetes only: a full kubeconfig (base64-encoded YAML — same content
  // `kubectl config view --raw` produces), plus the specific
  // namespace/pod/container this connection execs into. One Connection is
  // one specific pod, matching how ssh-direct/rdp/database are each one
  // specific pre-configured target — not a general kubectl-proxy that can
  // reach anything the credential can see.
  kubeconfig?: string;
  k8sNamespace?: string;
  k8sPodName?: string;
  k8sContainerName?: string;
  // database only: which engine to connect with. Optional and defaults to
  // "postgres" at the point of use (see dbEngineFor in index.ts) rather
  // than being backfilled here, so every database connection saved before
  // this field existed keeps working unchanged instead of needing a
  // migration.
  dbEngine?: "postgres" | "mysql" | "mongodb" | "redis";
}

export interface SshKey {
  id: string;
  ownerUsername: string;
  name: string;
  privateKey: string;
  passphrase: string;
  createdAt: number;
}

// Loaded from SQLite on startup (see db.ts) — the in-memory arrays below
// are still the primary read path every function in this file uses, but
// they're now a cache in front of real persistence, not the only copy.
// Every mutator (create/update/delete) below also writes through to the
// DB; nothing here relies on a full re-serialize on exit, since a killed
// process (crash, kill -9) wouldn't get to run one anyway — the write
// happens at the moment of the mutation instead.
export const users: User[] = loadTable<User>("users");
export const roles: Role[] = loadTable<Role>("roles");
export const connections: Connection[] = loadTable<Connection>("connections");
export const organizations: Organization[] = loadTable<Organization>("organizations");
export const sshKeys: SshKey[] = loadTable<SshKey>("sshKeys");

function defaultRole(overrides: Partial<Role> & Pick<Role, "name" | "description">): Role {
  return {
    category: "",
    allowLabels: {},
    denyLabels: {},
    resourceTypes: [],
    logins: ["demo"],
    maxSessionTTLMinutes: 480,
    allowedCIDRs: [],
    expiresAt: null,
    manageLabels: {},
    allowClipboard: true,
    breakGlassEligible: false,
    ...overrides,
  };
}

// Seeding only ever happens against an empty table — once real persisted
// data exists (this DB file has been written to before), none of this
// runs again, so an admin's changes to the seeded roles/users/connections
// survive every future restart instead of being silently re-created
// alongside them.
if (roles.length === 0) {
  const seedRoles = [
    defaultRole({
      name: "admin",
      description: "Full access to every connected resource, every type, every login, full admin API",
      category: "Built-in",
      allowLabels: {},
      logins: ["demo", "ubuntu", "postgres"],
    }),
    defaultRole({
      name: "client-acme-corp-access",
      description: "Scoped to Client A (acme-corp) SSH-agent resources only",
      category: "Acme Corp",
      allowLabels: { client: ["acme-corp"] },
      resourceTypes: ["ssh-agent"],
      maxSessionTTLMinutes: 60,
    }),
    defaultRole({
      name: "client-acme-corp-delegated-admin",
      description: "Tenant admin for Client A (acme-corp): manages that tenant's own users + connections, not roles",
      category: "Acme Corp",
      allowLabels: { client: ["acme-corp"] },
      logins: ["demo", "ubuntu", "postgres"],
      manageLabels: { client: ["acme-corp"] },
    }),
  ];
  roles.push(...seedRoles);
  for (const r of seedRoles) saveRow("roles", r.name, r);
}

if (organizations.length === 0) {
  const seedOrgs: Organization[] = [
    { id: "acme-corp", name: "Acme Corp", createdAt: Date.now() },
    { id: "globex-inc", name: "Globex Inc", createdAt: Date.now() },
  ];
  organizations.push(...seedOrgs);
  for (const o of seedOrgs) saveRow("organizations", o.id, o);
}

function seedUser(username: string, password: string, userRoles: string[], tenant = "") {
  const user: User = { username, passwordHash: bcrypt.hashSync(password, 10), roles: userRoles, tenant, createdAt: Date.now() };
  users.push(user);
  saveRow("users", user.username, user);
}

if (users.length === 0) {
  seedUser("admin", "admin123", ["admin"]);
  seedUser("alice", "alice123", ["client-acme-corp-access"], "acme-corp");
  seedUser("acme-admin", "acmeadmin123", ["client-acme-corp-delegated-admin"], "acme-corp");
  seedUser("bob", "bob1234567", [], "acme-corp"); // no roles yet — a candidate for direct per-connection assignment
}

if (connections.length === 0) {
  const seedConnections: Connection[] = [
    {
      id: "client-a-desktop-01",
      hostname: "client-a-desktop-01",
      type: "rdp",
      labels: { client: "acme-corp", region: "us-east-1", env: "prod" },
      folder: "Client A / Desktops",
      host: process.env.RDP_TARGET_HOST ?? "rdp-target",
      port: Number(process.env.RDP_TARGET_PORT ?? 3389),
      username: process.env.RDP_TARGET_USER ?? "ubuntu",
      password: process.env.RDP_TARGET_PASSWORD ?? "demo1234",
      databaseName: "",
      assignedUsers: [],
      createdAt: Date.now(),
      createdBy: "seed",
    },
    {
      id: "client-a-vnc-01",
      hostname: "client-a-vnc-01",
      type: "vnc",
      labels: { client: "acme-corp", region: "us-east-1", env: "prod" },
      folder: "Client A / Desktops",
      // Same reasoning as the RDP target above — dialed by guacd, which
      // runs *inside* the Docker network, so it uses the container name.
      host: process.env.VNC_TARGET_HOST ?? "vnc-target",
      port: Number(process.env.VNC_TARGET_PORT ?? 5900),
      // VNC/RFB has no real username concept (guac.ts's VNC connect-args
      // never ask guacd for one, so this is never actually sent) — but
      // `username` still doubles as the RBAC "login" dimension every
      // connection type is scoped by (see loginAllowed in rbac.ts, which
      // requires an exact match against a role's `logins` list). Reusing
      // "demo" — the same login the seeded ssh-target/db-target
      // connections already use — keeps this connection reachable by the
      // existing seed roles without inventing a new logins entry.
      username: "demo",
      password: process.env.VNC_TARGET_PASSWORD ?? "demo1234",
      databaseName: "",
      assignedUsers: [],
      createdAt: Date.now(),
      createdBy: "seed",
    },
    {
      id: "client-a-bastion-01",
      hostname: "client-a-bastion-01",
      type: "ssh-direct",
      labels: { client: "acme-corp", region: "us-east-1", env: "prod" },
      folder: "Client A / Servers",
      // Unlike the RDP target (dialed by guacd, which runs *inside* the
      // Docker network), this is dialed directly by the control plane
      // itself, which runs on the host — so it needs the mapped host port,
      // not the container's own network hostname.
      host: process.env.SSH_TARGET_HOST ?? "localhost",
      port: Number(process.env.SSH_TARGET_PORT ?? 2222),
      username: process.env.SSH_TARGET_USER ?? "demo",
      password: process.env.SSH_TARGET_PASSWORD ?? "demo1234",
      databaseName: "",
      assignedUsers: [],
      createdAt: Date.now(),
      createdBy: "seed",
    },
    {
      id: "client-a-appdb-01",
      hostname: "client-a-appdb-01",
      type: "database",
      labels: { client: "acme-corp", region: "us-east-1", env: "prod" },
      folder: "Client A / Databases",
      // Same reasoning as ssh-direct above — dialed directly by the control
      // plane on the host, so localhost + the mapped port, not the container name.
      host: process.env.DB_TARGET_HOST ?? "localhost",
      port: Number(process.env.DB_TARGET_PORT ?? 5432),
      username: process.env.DB_TARGET_USER ?? "demo",
      password: process.env.DB_TARGET_PASSWORD ?? "demo1234",
      databaseName: process.env.DB_TARGET_NAME ?? "appdb",
      assignedUsers: [],
      createdAt: Date.now(),
      createdBy: "seed",
    },
  ];
  connections.push(...seedConnections);
  for (const c of seedConnections) saveRow("connections", c.id, c);
}

export function findUser(username: string): User | undefined {
  return users.find((u) => u.username === username);
}

export function getRole(name: string): Role | undefined {
  return roles.find((r) => r.name === name);
}

export function getRolesForUser(user: User): Role[] {
  return user.roles.map(getRole).filter((r): r is Role => Boolean(r));
}

export function publicUser(user: User) {
  const { passwordHash: _passwordHash, mfaSecret: _mfaSecret, ...rest } = user;
  return rest;
}

export function listUsers() {
  return users.map(publicUser);
}

export function createUser(username: string, password: string, userRoles: string[], tenant = ""): User {
  const user: User = { username, passwordHash: bcrypt.hashSync(password, 10), roles: userRoles, tenant, createdAt: Date.now() };
  users.push(user);
  saveRow("users", user.username, user);
  return user;
}

export function updateUser(
  username: string,
  changes: { roles?: string[]; password?: string; tenant?: string; avatar?: string | null; mfaEnabled?: boolean; mfaSecret?: string | null }
): User | undefined {
  const user = findUser(username);
  if (!user) return undefined;
  if (changes.roles) user.roles = changes.roles;
  if (changes.password) {
    user.passwordHash = bcrypt.hashSync(changes.password, 10);
    // A new password invalidates every already-issued token — bump the
    // version so verifyTokenLive (auth.ts) rejects them on next use.
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  }
  if (changes.tenant !== undefined) user.tenant = changes.tenant;
  if (changes.avatar !== undefined) user.avatar = changes.avatar ?? undefined;
  if (changes.mfaEnabled !== undefined) user.mfaEnabled = changes.mfaEnabled;
  if (changes.mfaSecret !== undefined) user.mfaSecret = changes.mfaSecret ?? undefined;
  saveRow("users", user.username, user);
  return user;
}

// Admin "log out everywhere" — revokes every token the target user
// currently holds without touching their password.
export function bumpTokenVersion(username: string): User | undefined {
  const user = findUser(username);
  if (!user) return undefined;
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  saveRow("users", user.username, user);
  return user;
}

export function deleteUser(username: string): boolean {
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) return false;
  users.splice(idx, 1);
  deleteRow("users", username);
  return true;
}

export function listRoles(): Role[] {
  return roles;
}

export function createRole(role: Role): Role {
  roles.push(role);
  saveRow("roles", role.name, role);
  return role;
}

export function updateRole(name: string, changes: Partial<Omit<Role, "name">>): Role | undefined {
  const role = getRole(name);
  if (!role) return undefined;
  Object.assign(role, changes);
  saveRow("roles", role.name, role);
  return role;
}

export function deleteRole(name: string): boolean {
  const idx = roles.findIndex((r) => r.name === name);
  if (idx === -1) return false;
  roles.splice(idx, 1);
  deleteRow("roles", name);
  return true;
}

export function listConnections(): Connection[] {
  return connections;
}

export function getConnection(id: string): Connection | undefined {
  return connections.find((c) => c.id === id);
}

export function createConnection(conn: Connection): Connection {
  connections.push(conn);
  saveRow("connections", conn.id, conn);
  return conn;
}

export function updateConnection(id: string, changes: Partial<Omit<Connection, "id">>): Connection | undefined {
  const conn = getConnection(id);
  if (!conn) return undefined;
  Object.assign(conn, changes);
  saveRow("connections", conn.id, conn);
  return conn;
}

export function deleteConnection(id: string): boolean {
  const idx = connections.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  connections.splice(idx, 1);
  deleteRow("connections", id);
  return true;
}

// Bulk "assign this whole folder to these users" — merges (doesn't
// replace) each connection's existing direct grants, so assigning a
// second folder to someone doesn't clobber their first.
export function assignFolderToUsers(folder: string, usernames: string[]): Connection[] {
  const affected = connections.filter((c) => c.folder === folder);
  for (const conn of affected) {
    const merged = new Set([...conn.assignedUsers, ...usernames]);
    conn.assignedUsers = Array.from(merged);
    saveRow("connections", conn.id, conn);
  }
  return affected;
}

export function listOrganizations(): Organization[] {
  return organizations;
}

export function createOrganization(id: string, name: string): Organization {
  const org: Organization = { id, name, createdAt: Date.now() };
  organizations.push(org);
  saveRow("organizations", org.id, org);
  return org;
}

export function getOrganization(id: string): Organization | undefined {
  return organizations.find((o) => o.id === id);
}

export function updateOrganization(
  id: string,
  changes: { name?: string; brandName?: string | null; brandColor?: string | null; logoDataUri?: string | null }
): Organization | undefined {
  const org = getOrganization(id);
  if (!org) return undefined;
  if (changes.name) org.name = changes.name;
  if (changes.brandName !== undefined) org.brandName = changes.brandName ?? undefined;
  if (changes.brandColor !== undefined) org.brandColor = changes.brandColor ?? undefined;
  if (changes.logoDataUri !== undefined) org.logoDataUri = changes.logoDataUri ?? undefined;
  saveRow("organizations", org.id, org);
  return org;
}

export function deleteOrganization(id: string): boolean {
  const idx = organizations.findIndex((o) => o.id === id);
  if (idx === -1) return false;
  organizations.splice(idx, 1);
  deleteRow("organizations", id);
  return true;
}

// ---------- JIT access requests / approval workflow / break-glass ----------

export type AccessRequestStatus = "pending" | "approved" | "denied" | "revoked" | "expired";

export interface AccessRequest {
  id: string;
  requestedBy: string;
  resourceId: string;
  login: string;
  reason: string;
  status: AccessRequestStatus;
  createdAt: number;
  decidedBy?: string;
  decidedAt?: number;
  denyReason?: string;
  // Set once approved (including break-glass self-approval) — the grant
  // that RBAC checks against is "status === approved AND now < expiresAt",
  // nothing else; a revoke or natural expiry just needs one of those to
  // stop being true, no separate "is this grant still alive" bookkeeping.
  expiresAt?: number;
  breakGlass: boolean;
}

export const accessRequests: AccessRequest[] = loadTable<AccessRequest>("accessRequests");

export function createAccessRequest(requestedBy: string, resourceId: string, login: string, reason: string, breakGlass: boolean): AccessRequest {
  const req: AccessRequest = {
    id: crypto.randomUUID(),
    requestedBy,
    resourceId,
    login,
    reason,
    status: "pending",
    createdAt: Date.now(),
    breakGlass,
  };
  accessRequests.push(req);
  saveRow("accessRequests", req.id, req);
  return req;
}

export function listAccessRequests(): AccessRequest[] {
  return accessRequests;
}

export function getAccessRequest(id: string): AccessRequest | undefined {
  return accessRequests.find((r) => r.id === id);
}

export function approveAccessRequest(id: string, decidedBy: string, ttlMinutes: number): AccessRequest | undefined {
  const req = getAccessRequest(id);
  if (!req) return undefined;
  req.status = "approved";
  req.decidedBy = decidedBy;
  req.decidedAt = Date.now();
  req.expiresAt = Date.now() + ttlMinutes * 60_000;
  saveRow("accessRequests", req.id, req);
  return req;
}

export function denyAccessRequest(id: string, decidedBy: string, reason: string): AccessRequest | undefined {
  const req = getAccessRequest(id);
  if (!req) return undefined;
  req.status = "denied";
  req.decidedBy = decidedBy;
  req.decidedAt = Date.now();
  req.denyReason = reason;
  saveRow("accessRequests", req.id, req);
  return req;
}

export function revokeAccessRequest(id: string, decidedBy: string): AccessRequest | undefined {
  const req = getAccessRequest(id);
  if (!req) return undefined;
  req.status = "revoked";
  req.decidedBy = decidedBy;
  req.decidedAt = Date.now();
  saveRow("accessRequests", req.id, req);
  return req;
}

// The check RBAC actually calls: is there a currently-live approved grant
// for this exact (user, resource, login) triple? Deliberately narrow —
// approval is for one resource+login at a time, never "everything."
export function hasActiveGrant(username: string, resourceId: string, login: string): boolean {
  return accessRequests.some(
    (r) =>
      r.requestedBy === username &&
      r.resourceId === resourceId &&
      r.login === login &&
      r.status === "approved" &&
      r.expiresAt !== undefined &&
      Date.now() < r.expiresAt
  );
}

// Looser version for resource *visibility* (the Resources list) — any live
// grant on the resource, regardless of which login it names, since a user
// deciding whether to click "connect" doesn't necessarily know the exact
// login string a grant was issued for ahead of time.
export function hasAnyActiveGrantForResource(username: string, resourceId: string): boolean {
  return accessRequests.some(
    (r) => r.requestedBy === username && r.resourceId === resourceId && r.status === "approved" && r.expiresAt !== undefined && Date.now() < r.expiresAt
  );
}

export interface AuditEvent {
  id: string;
  ts: number;
  username: string;
  eventType: string;
  resourceId: string | null;
  details: string;
  // Hash-chain fields — present only on entries logged after this feature
  // shipped. Older entries have neither field; verifyAuditChain reports
  // them honestly as "pre-hardening, unverifiable" rather than pretending
  // they were always chained. hash = sha256(prevHash + payload), where
  // payload is the entry's other fields in a fixed key order (see
  // auditChainPayload) so it's reproducible regardless of object literal
  // insertion order.
  prevHash?: string;
  hash?: string;
}

// Fired after every audit event is durably written — SIEM export
// (siemExport.ts) subscribes to this instead of logAudit importing it
// directly, so store.ts (the lowest-level module) never has to know
// exporting even exists. Any other future "do something whenever
// something noteworthy happens" consumer could hook in here too.
type AuditListener = (event: AuditEvent) => void;
const auditListeners: AuditListener[] = [];
export function onAuditEvent(listener: AuditListener) {
  auditListeners.push(listener);
}

const AUDIT_CHAIN_GENESIS = "0".repeat(64);

function auditChainPayload(event: Omit<AuditEvent, "prevHash" | "hash">): string {
  return JSON.stringify({
    id: event.id,
    ts: event.ts,
    username: event.username,
    eventType: event.eventType,
    resourceId: event.resourceId,
    details: event.details,
  });
}

// Seeds the in-memory chain tip from the last line on disk at startup —
// its .hash if it's a chained (post-hardening) entry, or genesis if the
// file is empty/missing or its last entry predates chaining.
function seedLastAuditHash(): string {
  if (!fs.existsSync(AUDIT_LOG_PATH)) return AUDIT_CHAIN_GENESIS;
  const lines = fs.readFileSync(AUDIT_LOG_PATH, "utf8").split("\n").filter(Boolean);
  if (lines.length === 0) return AUDIT_CHAIN_GENESIS;
  try {
    const last = JSON.parse(lines[lines.length - 1]) as AuditEvent;
    return last.hash ?? AUDIT_CHAIN_GENESIS;
  } catch {
    return AUDIT_CHAIN_GENESIS;
  }
}

let lastAuditHash = seedLastAuditHash();

// Append-only file: nothing ever rewrites or deletes a line, which is the
// property that actually matters for "tamper-evident audit log" — a real
// deployment would still want this backed by object storage with
// write-once/legal-hold, not a local file, but the shape is the same. Each
// entry's hash also binds it to every entry before it (see
// verifyAuditChain), so an in-place edit or deletion anywhere in the file
// is detectable, not just an append.
export function logAudit(username: string, eventType: string, resourceId: string | null, details: string) {
  const base = { id: crypto.randomUUID(), ts: Date.now(), username, eventType, resourceId, details };
  const prevHash = lastAuditHash;
  const hash = crypto.createHash("sha256").update(prevHash + auditChainPayload(base)).digest("hex");
  const event: AuditEvent = { ...base, prevHash, hash };
  lastAuditHash = hash;
  fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(event) + "\n");
  for (const listener of auditListeners) listener(event);
}

export interface AuditChainVerifyResult {
  valid: boolean;
  brokenAtId?: string;
  unverifiableCount: number;
  verifiedCount: number;
}

// Walks the whole file from genesis and recomputes the chain — proof the
// verify actually catches tampering, not just that it passes on clean
// data. Entries before chaining shipped have no hash and are counted as
// unverifiableCount rather than failing the whole chain; once a chained
// entry has been seen, every entry after it is expected to be chained too
// (a missing hash there is a real break, e.g. a deleted line).
export function verifyAuditChain(): AuditChainVerifyResult {
  if (!fs.existsSync(AUDIT_LOG_PATH)) return { valid: true, unverifiableCount: 0, verifiedCount: 0 };
  const lines = fs.readFileSync(AUDIT_LOG_PATH, "utf8").split("\n").filter(Boolean);
  let expectedPrev = AUDIT_CHAIN_GENESIS;
  let unverifiableCount = 0;
  let verifiedCount = 0;
  let sawChained = false;
  for (const line of lines) {
    let event: AuditEvent;
    try {
      event = JSON.parse(line) as AuditEvent;
    } catch {
      return { valid: false, unverifiableCount, verifiedCount };
    }
    if (!event.hash || !event.prevHash) {
      if (sawChained) return { valid: false, brokenAtId: event.id, unverifiableCount, verifiedCount };
      unverifiableCount++;
      continue;
    }
    sawChained = true;
    const base = { id: event.id, ts: event.ts, username: event.username, eventType: event.eventType, resourceId: event.resourceId, details: event.details };
    const expectedHash = crypto.createHash("sha256").update(expectedPrev + auditChainPayload(base)).digest("hex");
    if (event.prevHash !== expectedPrev || event.hash !== expectedHash) {
      return { valid: false, brokenAtId: event.id, unverifiableCount, verifiedCount };
    }
    expectedPrev = event.hash;
    verifiedCount++;
  }
  return { valid: true, unverifiableCount, verifiedCount };
}

// ---------- SIEM export config (single global target, not per-org) ----------

export interface SiemConfig {
  enabled: boolean;
  webhookUrl: string;
  secret: string;
  updatedAt: number;
  updatedBy: string;
}

let siemConfig: SiemConfig | null = loadTable<SiemConfig>("siemConfig")[0] ?? null;

export function getSiemConfig(): SiemConfig | null {
  return siemConfig;
}

export function setSiemConfig(patch: { enabled: boolean; webhookUrl: string; secret: string }, updatedBy: string): SiemConfig {
  siemConfig = { ...patch, updatedAt: Date.now(), updatedBy };
  saveRow("siemConfig", "global", siemConfig);
  return siemConfig;
}

// ---------- SMTP config (single global sender, used for monitor alert emails) ----------

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean; // true = implicit TLS (typically port 465); false = plain/STARTTLS (587/25)
  username: string;
  password: string;
  fromAddress: string;
  toAddresses: string[];
  updatedAt: number;
  updatedBy: string;
}

let smtpConfig: SmtpConfig | null = loadTable<SmtpConfig>("smtpConfig")[0] ?? null;

export function getSmtpConfig(): SmtpConfig | null {
  return smtpConfig;
}

export function setSmtpConfig(patch: Omit<SmtpConfig, "updatedAt" | "updatedBy">, updatedBy: string): SmtpConfig {
  smtpConfig = { ...patch, updatedAt: Date.now(), updatedBy };
  saveRow("smtpConfig", "global", smtpConfig);
  return smtpConfig;
}

// ---------- Security policy (single global platform-wide policy) ----------

export interface SecurityPolicy {
  requireMfaForAdmins: boolean;
  // CIDR blocks (e.g. "10.0.0.0/8", "203.0.113.4/32"); empty = no
  // restriction, matching today's (unrestricted) behavior.
  adminIpAllowlist: string[];
  // Login rate limiting / account lockout — previously hardcoded constants
  // in index.ts's loginLimiter, now read live from here on every check
  // instead of being baked into a closure at server start (same "live, not
  // startup-snapshotted" principle already used for RBAC roles elsewhere).
  loginMaxAttempts: number;
  loginWindowMinutes: number;
  loginLockoutMinutes: number;
  updatedAt: number;
  updatedBy: string;
}

const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  requireMfaForAdmins: false,
  adminIpAllowlist: [],
  loginMaxAttempts: 5,
  loginWindowMinutes: 15,
  loginLockoutMinutes: 15,
  updatedAt: 0,
  updatedBy: "",
};

// Merged, not replaced: a record persisted before loginMaxAttempts/
// loginWindowMinutes/loginLockoutMinutes existed would otherwise silently
// drop those fields to undefined for every reader (including the login
// rate limiter itself) until the next full save.
let securityPolicy: SecurityPolicy = { ...DEFAULT_SECURITY_POLICY, ...(loadTable<SecurityPolicy>("securityPolicy")[0] ?? {}) };

export function getSecurityPolicy(): SecurityPolicy {
  return securityPolicy;
}

export function setSecurityPolicy(
  patch: { requireMfaForAdmins: boolean; adminIpAllowlist: string[]; loginMaxAttempts: number; loginWindowMinutes: number; loginLockoutMinutes: number },
  updatedBy: string
): SecurityPolicy {
  securityPolicy = { ...patch, updatedAt: Date.now(), updatedBy };
  saveRow("securityPolicy", "global", securityPolicy);
  return securityPolicy;
}

// ---------- Dashboard widget layout (per-user, like a personal Grafana home dashboard) ----------

export interface DashboardWidgetInstance {
  id: string; // instance id, distinct from `type` — the same widget type can be added more than once
  type: string;
  size: "small" | "medium" | "large";
}

const dashboardLayouts = new Map<string, DashboardWidgetInstance[]>(
  loadTable<{ username: string; widgets: DashboardWidgetInstance[] }>("dashboardLayouts").map((r) => [r.username, r.widgets])
);

export function getDashboardLayout(username: string): DashboardWidgetInstance[] | undefined {
  return dashboardLayouts.get(username);
}

export function setDashboardLayout(username: string, widgets: DashboardWidgetInstance[]): DashboardWidgetInstance[] {
  dashboardLayouts.set(username, widgets);
  saveRow("dashboardLayouts", username, { username, widgets });
  return widgets;
}

// ---------- Webhook plugins (many independent, event-filtered targets —
// contrast with SIEM export above, which is one global, unfiltered stream) ----------

export interface WebhookPlugin {
  id: string;
  name: string;
  enabled: boolean;
  // Which audit eventTypes this plugin fires on — empty array means "all",
  // same convention Role.resourceTypes already uses for "unrestricted".
  eventTypes: string[];
  webhookUrl: string;
  secret: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
}

export const webhookPlugins: WebhookPlugin[] = loadTable<WebhookPlugin>("webhookPlugins");

export function listWebhookPlugins(): WebhookPlugin[] {
  return webhookPlugins;
}

export function getWebhookPlugin(id: string): WebhookPlugin | undefined {
  return webhookPlugins.find((p) => p.id === id);
}

export function createWebhookPlugin(data: Omit<WebhookPlugin, "id" | "createdAt" | "updatedAt">): WebhookPlugin {
  const plugin: WebhookPlugin = { ...data, id: crypto.randomUUID(), createdAt: Date.now(), updatedAt: Date.now() };
  webhookPlugins.push(plugin);
  saveRow("webhookPlugins", plugin.id, plugin);
  return plugin;
}

export function updateWebhookPlugin(id: string, changes: Partial<Omit<WebhookPlugin, "id" | "createdAt" | "createdBy">>): WebhookPlugin | undefined {
  const plugin = getWebhookPlugin(id);
  if (!plugin) return undefined;
  Object.assign(plugin, changes, { updatedAt: Date.now() });
  saveRow("webhookPlugins", plugin.id, plugin);
  return plugin;
}

export function deleteWebhookPlugin(id: string): boolean {
  const idx = webhookPlugins.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  webhookPlugins.splice(idx, 1);
  deleteRow("webhookPlugins", id);
  return true;
}

// ---------- Per-user notification state ----------
// Just a "cleared before this timestamp" marker, not a per-notification
// read/unread table — matches how a real notification bell's "clear"
// action almost always works (one watermark, not N rows to maintain).

interface NotificationState {
  username: string;
  clearedAt: number;
}

const notificationState = new Map<string, NotificationState>(
  loadTable<NotificationState>("notificationState").map((s) => [s.username, s])
);

export function getNotificationClearedAt(username: string): number {
  return notificationState.get(username)?.clearedAt ?? 0;
}

export function clearNotificationsFor(username: string): number {
  const clearedAt = Date.now();
  notificationState.set(username, { username, clearedAt });
  saveRow("notificationState", username, { username, clearedAt });
  return clearedAt;
}

// ---------- WebAuthn / passkey credentials (per-user) ----------

export function listWebauthnCredentials(username: string): WebauthnCredentialRecord[] {
  return findUser(username)?.webauthnCredentials ?? [];
}

export function addWebauthnCredential(username: string, cred: WebauthnCredentialRecord) {
  const user = findUser(username);
  if (!user) return;
  user.webauthnCredentials = [...(user.webauthnCredentials ?? []), cred];
  saveRow("users", user.username, user);
}

export function removeWebauthnCredential(username: string, credentialId: string): boolean {
  const user = findUser(username);
  if (!user?.webauthnCredentials) return false;
  const before = user.webauthnCredentials.length;
  user.webauthnCredentials = user.webauthnCredentials.filter((c) => c.id !== credentialId);
  if (user.webauthnCredentials.length !== before) saveRow("users", user.username, user);
  return user.webauthnCredentials.length !== before;
}

export function updateWebauthnCounter(username: string, credentialId: string, counter: number) {
  const user = findUser(username);
  const cred = user?.webauthnCredentials?.find((c) => c.id === credentialId);
  if (cred && user) {
    cred.counter = counter;
    saveRow("users", user.username, user);
  }
}

// ---------- SSH keys (per-user, attachable to ssh-direct connections) ----------

export function listSshKeysForUser(username: string): SshKey[] {
  return sshKeys.filter((k) => k.ownerUsername === username);
}

export function listAllSshKeys(): SshKey[] {
  return sshKeys;
}

export function getSshKey(id: string): SshKey | undefined {
  return sshKeys.find((k) => k.id === id);
}

export function createSshKey(ownerUsername: string, name: string, privateKey: string, passphrase = ""): SshKey {
  const key: SshKey = { id: crypto.randomUUID(), ownerUsername, name, privateKey, passphrase, createdAt: Date.now() };
  sshKeys.push(key);
  saveRow("sshKeys", key.id, key);
  return key;
}

export function deleteSshKey(id: string): boolean {
  const idx = sshKeys.findIndex((k) => k.id === id);
  if (idx === -1) return false;
  sshKeys.splice(idx, 1);
  deleteRow("sshKeys", id);
  // Any connection pointing at this key falls back to its stored password
  // (if any) rather than being left referencing a dangling id.
  for (const conn of connections) {
    if (conn.sshKeyId === id) {
      conn.sshKeyId = undefined;
      saveRow("connections", conn.id, conn);
    }
  }
  return true;
}

// Public (safe-to-return) shape — never sends the private key back down
// once stored, same reasoning as passwordHash never leaving the server.
export function publicSshKey(key: SshKey) {
  const { privateKey: _privateKey, passphrase: _passphrase, ...rest } = key;
  return rest;
}

// ---------- agent joining: single-use join tokens + persistent per-agent identity ----------
//
// Replaces "every agent shares one long-lived secret forever" with a
// two-phase model closer to how real IAM-based joining behaves (prove
// identity once, then re-authenticate with something only that specific
// agent could produce): a join token is consumed exactly once to bootstrap
// an agent's own ed25519 keypair into `agentIdentities`; every reconnect
// after that authenticates by signing a fresh challenge with the agent's
// own private key, never touching a token again. A leaked join token is
// only ever useful for a single first-join, not indefinite access — and a
// leaked identity public key is useless without the matching private key,
// unlike a leaked shared secret.

export interface JoinToken {
  token: string;
  label: string;
  createdBy: string;
  createdAt: number;
  maxUses: number;
  uses: number;
  expiresAt: number;
  revoked: boolean;
  // Which identity this token is allowed to bootstrap — undefined for
  // agent-join tokens (their subject is implicit: whichever agent presents
  // the token, per the existing /agent WS handshake). Set to a Bot's id
  // for bot-join tokens (see "Bots" below), so one shared token-validity
  // mechanism can't be used to bootstrap into an identity it wasn't issued
  // for.
  subjectId?: string;
}

export const joinTokens: JoinToken[] = loadTable<JoinToken>("joinTokens");

export function createJoinToken(createdBy: string, label: string, maxUses: number, ttlMinutes: number, subjectId?: string): JoinToken {
  const token: JoinToken = {
    token: crypto.randomBytes(24).toString("hex"),
    label,
    createdBy,
    createdAt: Date.now(),
    maxUses,
    uses: 0,
    expiresAt: Date.now() + ttlMinutes * 60_000,
    revoked: false,
    subjectId,
  };
  joinTokens.push(token);
  saveRow("joinTokens", token.token, token);
  return token;
}

export function listJoinTokens(): JoinToken[] {
  return joinTokens;
}

export function revokeJoinToken(token: string): boolean {
  const t = joinTokens.find((j) => j.token === token);
  if (!t) return false;
  t.revoked = true;
  saveRow("joinTokens", t.token, t);
  return true;
}

// Validates and, if valid, atomically consumes one use. Returns a reason
// string on failure so the caller can tell the agent (and the audit log)
// specifically why — expired vs. exhausted vs. revoked vs. unknown are
// different operational problems.
export function consumeJoinToken(token: string): { ok: true } | { ok: false; reason: string } {
  const t = joinTokens.find((j) => j.token === token);
  if (!t) return { ok: false, reason: "unknown join token" };
  if (t.revoked) return { ok: false, reason: "join token revoked" };
  if (Date.now() > t.expiresAt) return { ok: false, reason: "join token expired" };
  if (t.uses >= t.maxUses) return { ok: false, reason: "join token already used" };
  t.uses++;
  saveRow("joinTokens", t.token, t);
  return { ok: true };
}

// ---------- Bots (machine identity — see docs/plans/2026-07-29-machine-id-bots.md) ----------
// Deliberately User-shaped-but-simpler: a Bot is a real identity with real
// Role assignments, so the entire existing RBAC engine (labels, resource-
// type scoping, login allowlists, CIDR) applies to it unchanged — no new
// authorization logic, only a different way of authenticating.

export interface Bot {
  id: string;
  roles: string[];
  createdAt: number;
  createdBy: string;
  // Bumped to instantly revoke every token this bot currently holds — same
  // "log out everywhere" mechanism as User.tokenVersion.
  tokenVersion?: number;
  lastJoinedAt?: number;
  lastJoinIp?: string;
}

export const bots: Bot[] = loadTable<Bot>("bots");

export function findBot(id: string): Bot | undefined {
  return bots.find((b) => b.id === id);
}

export function listBots(): Bot[] {
  return bots;
}

export function createBot(id: string, roles: string[], createdBy: string): Bot {
  const bot: Bot = { id, roles, createdAt: Date.now(), createdBy };
  bots.push(bot);
  saveRow("bots", bot.id, bot);
  return bot;
}

export function updateBotRoles(id: string, roles: string[]): Bot | undefined {
  const bot = findBot(id);
  if (!bot) return undefined;
  bot.roles = roles;
  saveRow("bots", bot.id, bot);
  return bot;
}

export function recordBotJoin(id: string, ip: string | undefined): void {
  const bot = findBot(id);
  if (!bot) return;
  bot.lastJoinedAt = Date.now();
  bot.lastJoinIp = ip;
  saveRow("bots", bot.id, bot);
}

export function bumpBotTokenVersion(id: string): Bot | undefined {
  const bot = findBot(id);
  if (!bot) return undefined;
  bot.tokenVersion = (bot.tokenVersion ?? 0) + 1;
  saveRow("bots", bot.id, bot);
  return bot;
}

export function deleteBot(id: string): boolean {
  const idx = bots.findIndex((b) => b.id === id);
  if (idx === -1) return false;
  bots.splice(idx, 1);
  deleteRow("bots", id);
  return true;
}

export interface AgentIdentity {
  agentId: string;
  publicKeyPem: string;
  registeredAt: number;
  joinTokenLabel: string;
}

// Keyed by agent id, survives individual connect/disconnect cycles (unlike
// state.ts's `agents` map, which only holds currently-live sockets) —
// this is what makes reconnecting without a token possible at all. Loaded
// from the DB as a list, rebuilt into a Map for O(1) lookup at runtime.
export const agentIdentities = new Map<string, AgentIdentity>(loadTable<AgentIdentity>("agentIdentities").map((a) => [a.agentId, a]));

export function registerAgentIdentity(agentId: string, publicKeyPem: string, joinTokenLabel: string) {
  const identity: AgentIdentity = { agentId, publicKeyPem, registeredAt: Date.now(), joinTokenLabel };
  agentIdentities.set(agentId, identity);
  saveRow("agentIdentities", agentId, identity);
}

export function getAgentIdentity(agentId: string): AgentIdentity | undefined {
  return agentIdentities.get(agentId);
}

// Challenge is just "the timestamp the agent claims to have signed at" —
// verifyAgentChallenge below also enforces it's recent, so this alone is
// what prevents a captured signature from being replayed indefinitely.
export function verifyAgentSignature(agentId: string, timestamp: string, signatureB64: string): boolean {
  const identity = getAgentIdentity(agentId);
  if (!identity) return false;
  try {
    const publicKey = crypto.createPublicKey(identity.publicKeyPem);
    return crypto.verify(null, Buffer.from(timestamp), publicKey, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

export function verifyAgentChallenge(agentId: string, timestamp: string, signatureB64: string): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 60_000) return false; // 60s replay window
  return verifyAgentSignature(agentId, timestamp, signatureB64);
}

export function readAudit(limit = 200): AuditEvent[] {
  if (!fs.existsSync(AUDIT_LOG_PATH)) return [];
  const lines = fs.readFileSync(AUDIT_LOG_PATH, "utf8").split("\n").filter(Boolean);
  return lines
    .slice(-limit)
    .map((l) => JSON.parse(l) as AuditEvent)
    .reverse();
}
