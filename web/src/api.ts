import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/browser";

export interface Session {
  token: string;
  username: string;
  roles: string[];
  isAdmin: boolean;
  isDelegatedAdmin: boolean;
}

export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
}

const STORAGE_KEY = "remotely_session";

export function getSession(): Session | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function setSession(session: Session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

// Thrown on any non-OK response. `body` carries the full JSON error payload
// (not just `.error`) so callers that need extra fields — e.g. the
// organization-delete conflict's affectedUsers/affectedConnections — can
// inspect them instead of only getting a flattened message string.
export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const session = getSession();
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
  });
  if (res.status === 401) {
    clearSession();
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({ error: res.statusText })));
  if (res.status === 204) return null;
  return res.json();
}

export async function login(username: string, password: string): Promise<Session | MfaChallenge> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "login failed");
  return res.json();
}

export async function verifyLoginMfa(mfaToken: string, code: string): Promise<Session> {
  const res = await fetch("/api/login/verify-mfa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mfaToken, code }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "verification failed");
  return res.json();
}

// Used by the SSO callback page: it's handed a bare session token (via a
// browser redirect, not a fetch response), so it needs to separately ask
// who that token actually belongs to — reuses the server's own role
// resolution instead of guessing isAdmin/isDelegatedAdmin from the raw JWT.
export async function sessionFromToken(token: string): Promise<Session> {
  const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error("invalid session token");
  const me = await res.json();
  return { token, username: me.username, roles: me.roles, isAdmin: me.isAdmin, isDelegatedAdmin: me.isDelegatedAdmin };
}

export interface Resource {
  id: string;
  hostname: string;
  labels: Record<string, string>;
  folder: string;
  type: string;
  connectedAt: number;
}

export function fetchResources(): Promise<Resource[]> {
  return apiFetch("/api/resources");
}

export interface AuditEvent {
  id: string;
  ts: number;
  username: string;
  eventType: string;
  resourceId: string | null;
  details: string;
}

export function fetchAudit(): Promise<AuditEvent[]> {
  return apiFetch("/api/audit");
}

export interface RecordingMeta {
  sessionId: string;
  sizeBytes: number;
  modifiedAt: number;
  username: string;
  resource: string;
  type: string;
}

export function fetchRecordings(): Promise<RecordingMeta[]> {
  return apiFetch("/api/recordings");
}

export interface RecordingFrame {
  t: number;
  dir: "i" | "o";
  data: string;
}

export interface RecordingDetail {
  type: string;
  frames: RecordingFrame[];
}

export function fetchRecording(sessionId: string): Promise<RecordingDetail> {
  return apiFetch(`/api/recordings/${sessionId}`);
}

export function deleteRecordingApi(sessionId: string): Promise<null> {
  return apiFetch(`/api/recordings/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

// ---------- admin: users ----------

export interface AdminUser {
  username: string;
  roles: string[];
  tenant: string;
  createdAt: number;
}

export function fetchUsers(): Promise<AdminUser[]> {
  return apiFetch("/api/admin/users");
}

export function createUserApi(username: string, password: string, roles: string[], tenant: string): Promise<AdminUser> {
  return apiFetch("/api/admin/users", { method: "POST", body: JSON.stringify({ username, password, roles, tenant }) });
}

export function updateUserApi(
  username: string,
  changes: { roles?: string[]; password?: string; tenant?: string }
): Promise<AdminUser> {
  return apiFetch(`/api/admin/users/${encodeURIComponent(username)}`, { method: "PATCH", body: JSON.stringify(changes) });
}

export function deleteUserApi(username: string): Promise<null> {
  return apiFetch(`/api/admin/users/${encodeURIComponent(username)}`, { method: "DELETE" });
}

// ---------- admin: roles ----------

export interface Role {
  name: string;
  description: string;
  category: string;
  allowLabels: Record<string, string[]>;
  denyLabels: Record<string, string[]>;
  resourceTypes: string[];
  logins: string[];
  maxSessionTTLMinutes: number;
  allowedCIDRs: string[];
  expiresAt: string | null;
  manageLabels: Record<string, string[]>;
  allowClipboard: boolean;
  breakGlassEligible: boolean;
}

export function fetchRoles(): Promise<Role[]> {
  return apiFetch("/api/admin/roles");
}

export function createRoleApi(role: Role): Promise<Role> {
  return apiFetch("/api/admin/roles", { method: "POST", body: JSON.stringify(role) });
}

export function updateRoleApi(name: string, role: Partial<Role>): Promise<Role> {
  return apiFetch(`/api/admin/roles/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify(role) });
}

export function deleteRoleApi(name: string): Promise<null> {
  return apiFetch(`/api/admin/roles/${encodeURIComponent(name)}`, { method: "DELETE" });
}

// ---------- admin: connections ----------

export type ConnectionType = "ssh-direct" | "rdp" | "database";

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
  assignedUsers: string[];
  createdAt: number;
  createdBy: string;
  sshKeyId?: string;
  sshJitEnabled?: boolean;
}

export function fetchConnections(): Promise<Connection[]> {
  return apiFetch("/api/admin/connections");
}

export function createConnectionApi(conn: Partial<Connection>): Promise<Connection> {
  return apiFetch("/api/admin/connections", { method: "POST", body: JSON.stringify(conn) });
}

export function updateConnectionApi(id: string, conn: Partial<Connection>): Promise<Connection> {
  return apiFetch(`/api/admin/connections/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(conn) });
}

export function deleteConnectionApi(id: string): Promise<null> {
  return apiFetch(`/api/admin/connections/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function assignFolderApi(folder: string, users: string[]): Promise<Connection[]> {
  return apiFetch("/api/admin/connections/assign-folder", { method: "POST", body: JSON.stringify({ folder, users }) });
}

// ---------- admin: organizations ----------

export interface Organization {
  id: string;
  name: string;
  createdAt: number;
  brandName?: string;
  brandColor?: string;
  logoDataUri?: string;
}

export function fetchOrganizations(): Promise<Organization[]> {
  return apiFetch("/api/admin/organizations");
}

export function createOrganizationApi(id: string, name: string): Promise<Organization> {
  return apiFetch("/api/admin/organizations", { method: "POST", body: JSON.stringify({ id, name }) });
}

export function updateOrganizationApi(
  id: string,
  changes: { name?: string; brandName?: string | null; brandColor?: string | null; logoDataUri?: string | null }
): Promise<Organization> {
  return apiFetch(`/api/admin/organizations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(changes) });
}

export function deleteOrganizationApi(id: string, force = false): Promise<null> {
  return apiFetch(`/api/admin/organizations/${encodeURIComponent(id)}${force ? "?force=true" : ""}`, { method: "DELETE" });
}

export interface OrgUsage {
  org: Organization;
  memberCount: number;
  resourceCount: number;
  sessionsStarted: number;
  sessionErrors: number;
  errorRate: number;
  totalSessionMinutes: number;
  sessionsWithDuration: number;
}

export function fetchOrgUsage(id: string): Promise<OrgUsage> {
  return apiFetch(`/api/admin/organizations/${encodeURIComponent(id)}/usage`);
}

export interface Branding {
  brandName: string | null;
  brandColor: string | null;
  logoDataUri: string | null;
}

export function fetchBranding(): Promise<Branding | null> {
  return apiFetch("/api/branding");
}

// ---------- notifications ----------

export interface NotificationEvent {
  id: string;
  ts: number;
  username: string;
  eventType: string;
  resourceId: string | null;
  details: string;
}

export function fetchNotifications(): Promise<NotificationEvent[]> {
  return apiFetch("/api/notifications");
}

// ---------- agent health ----------

export interface AgentHealthInfo {
  id: string;
  hostname: string;
  labels: Record<string, string>;
  type: string;
  version: string;
  connectedAt: number;
  uptimeSeconds: number;
  lastSeenSecondsAgo: number;
  lastLatencyMs: number | null;
  activeSessions: number;
  updateAvailable: boolean;
  hasIdentity: boolean;
}

export function fetchAgents(): Promise<AgentHealthInfo[]> {
  return apiFetch("/api/admin/agents");
}

export function triggerAgentUpdate(id: string): Promise<null> {
  return apiFetch(`/api/admin/agents/${encodeURIComponent(id)}/update`, { method: "POST" });
}

// ---------- admin: agent join tokens ----------

export interface JoinTokenItem {
  token: string;
  label: string;
  createdBy: string;
  createdAt: number;
  maxUses: number;
  uses: number;
  expiresAt: number;
  revoked: boolean;
}

export function fetchJoinTokens(): Promise<JoinTokenItem[]> {
  return apiFetch("/api/admin/join-tokens");
}

export function createJoinTokenApi(label: string, maxUses: number, ttlMinutes: number): Promise<JoinTokenItem> {
  return apiFetch("/api/admin/join-tokens", { method: "POST", body: JSON.stringify({ label, maxUses, ttlMinutes }) });
}

export function revokeJoinTokenApi(token: string): Promise<null> {
  return apiFetch(`/api/admin/join-tokens/${encodeURIComponent(token)}`, { method: "DELETE" });
}

// ---------- file transfer (ssh-direct connections + ssh-agent resources) ----------
// ssh-direct goes through /api/files (real SFTP, the control plane dials
// directly). ssh-agent goes through /api/agent-files (a request/response
// protocol over the existing agent WS tunnel — see state.ts's
// sendAgentFileRequest — since there's no direct connection to open SFTP
// against). Same shape either way from the frontend's perspective.

export type FileTransferKind = "ssh-direct" | "ssh-agent";

function fileBasePath(kind: FileTransferKind): string {
  return kind === "ssh-agent" ? "/api/agent-files" : "/api/files";
}

export interface FileEntry {
  name: string;
  size: number;
  isDirectory: boolean;
  modifiedAt: number;
}

export function fetchFileList(resourceId: string, dirPath: string, kind: FileTransferKind = "ssh-direct"): Promise<FileEntry[]> {
  return apiFetch(`${fileBasePath(kind)}/${encodeURIComponent(resourceId)}/list?path=${encodeURIComponent(dirPath)}`);
}

// Mints a 60-second, single-file-bound download token first (via the
// normal Authorization-header-authed apiFetch) rather than putting the
// long-lived session JWT itself in the URL — a plain browser navigation
// can't attach an Authorization header, but it can pass this narrow token,
// which is useless for anything but this one file a minute from now.
export async function fileDownloadUrl(resourceId: string, filePath: string, kind: FileTransferKind = "ssh-direct"): Promise<string> {
  const { token } = await apiFetch(`${fileBasePath(kind)}/${encodeURIComponent(resourceId)}/download-token`, {
    method: "POST",
    body: JSON.stringify({ path: filePath }),
  });
  return `${fileBasePath(kind)}/${encodeURIComponent(resourceId)}/download?path=${encodeURIComponent(filePath)}&dtoken=${encodeURIComponent(token)}`;
}

export async function uploadFile(
  resourceId: string,
  dirPath: string,
  file: File,
  kind: FileTransferKind = "ssh-direct"
): Promise<{ path: string; bytes: number }> {
  const session = getSession();
  const body = await file.arrayBuffer();
  const res = await fetch(
    `${fileBasePath(kind)}/${encodeURIComponent(resourceId)}/upload?path=${encodeURIComponent(dirPath)}&filename=${encodeURIComponent(file.name)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
      body,
    }
  );
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({ error: res.statusText })));
  return res.json();
}

// ---------- active sessions ----------

export interface ActiveSession {
  id: string;
  username: string;
  resourceId: string;
  resourceHostname: string;
  type: string;
  login: string | null;
  startedAt: number;
  durationSeconds: number;
  watchers: number;
}

export function fetchActiveSessions(): Promise<ActiveSession[]> {
  return apiFetch("/api/admin/sessions");
}

export function terminateSessionApi(id: string): Promise<null> {
  return apiFetch(`/api/admin/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---------- SSH keys ----------

export interface SshKeyMeta {
  id: string;
  ownerUsername: string;
  name: string;
  createdAt: number;
}

export function fetchMySshKeys(): Promise<SshKeyMeta[]> {
  return apiFetch("/api/ssh-keys");
}

export function fetchAllSshKeys(): Promise<SshKeyMeta[]> {
  return apiFetch("/api/admin/ssh-keys");
}

export function createSshKeyApi(name: string, privateKey: string, passphrase: string): Promise<SshKeyMeta> {
  return apiFetch("/api/ssh-keys", { method: "POST", body: JSON.stringify({ name, privateKey, passphrase }) });
}

export function deleteSshKeyApi(id: string): Promise<null> {
  return apiFetch(`/api/ssh-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---------- profile ----------

export interface Profile {
  username: string;
  tenant: string;
  roles: string[];
  avatar: string | null;
  mfaEnabled: boolean;
  createdAt: number;
}

export function fetchProfile(): Promise<Profile> {
  return apiFetch("/api/profile");
}

export function updateAvatarApi(avatar: string | null): Promise<null> {
  return apiFetch("/api/profile/avatar", { method: "PATCH", body: JSON.stringify({ avatar }) });
}

export function changePasswordApi(currentPassword: string, newPassword: string): Promise<null> {
  return apiFetch("/api/profile/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
}

export function fetchMyActivity(): Promise<AuditEvent[]> {
  return apiFetch("/api/profile/activity");
}

export function mfaSetupApi(): Promise<{ secret: string; otpauthUrl: string }> {
  return apiFetch("/api/profile/mfa/setup", { method: "POST" });
}

export function mfaVerifyApi(code: string): Promise<null> {
  return apiFetch("/api/profile/mfa/verify", { method: "POST", body: JSON.stringify({ code }) });
}

export function mfaDisableApi(currentPassword: string): Promise<null> {
  return apiFetch("/api/profile/mfa/disable", { method: "POST", body: JSON.stringify({ currentPassword }) });
}

// ---------- WebAuthn / passkeys ----------

export interface PasskeyMeta {
  id: string;
  deviceName: string;
  createdAt: number;
}

export function fetchPasskeys(): Promise<PasskeyMeta[]> {
  return apiFetch("/api/profile/webauthn/credentials");
}

export function deletePasskeyApi(id: string): Promise<null> {
  return apiFetch(`/api/profile/webauthn/credentials/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// These hit endpoints directly with fetch (not apiFetch) because
// register-options/login-options don't require — or in the login case,
// can't have — the usual Bearer session header.
export async function passkeyRegisterOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return apiFetch("/api/profile/webauthn/register-options", { method: "POST" });
}

export async function passkeyRegisterVerify(response: RegistrationResponseJSON, deviceName: string): Promise<PasskeyMeta> {
  return apiFetch("/api/profile/webauthn/register-verify", { method: "POST", body: JSON.stringify({ response, deviceName }) });
}

export async function passkeyLoginOptions(username: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const res = await fetch("/api/login/webauthn/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "could not start passkey login");
  return res.json();
}

export async function passkeyLoginVerify(username: string, response: AuthenticationResponseJSON): Promise<Session> {
  const res = await fetch("/api/login/webauthn/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, response }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "passkey login failed");
  return res.json();
}

// ---------- dashboard ----------

export interface DashboardData {
  kpis: {
    totalResources: number;
    activeSessions: number;
    totalUsers: number;
    agentsOnline: number;
    failedLogins24h: number;
  };
  resourcesByType: Record<string, number>;
  eventsByHour: { hour: string; login: number; login_failed: number; session_start: number; access_denied: number }[];
  sessionsByDay: { day: string; count: number }[];
  recentDenials: AuditEvent[];
}

export function fetchDashboard(): Promise<DashboardData> {
  return apiFetch("/api/admin/dashboard");
}

// ---------- JIT access requests ----------

export type AccessRequestStatus = "pending" | "approved" | "denied" | "revoked" | "expired";

export interface AccessRequestItem {
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
  expiresAt?: number;
  breakGlass: boolean;
}

export function createAccessRequestApi(resourceId: string, login: string, reason: string, breakGlass = false): Promise<AccessRequestItem> {
  return apiFetch("/api/access-requests", { method: "POST", body: JSON.stringify({ resourceId, login, reason, breakGlass }) });
}

export function fetchMyAccessRequests(): Promise<AccessRequestItem[]> {
  return apiFetch("/api/my-access-requests");
}

export function fetchAdminAccessRequests(status?: AccessRequestStatus): Promise<AccessRequestItem[]> {
  return apiFetch(`/api/admin/access-requests${status ? `?status=${status}` : ""}`);
}

export function approveAccessRequestApi(id: string, ttlMinutes: number): Promise<AccessRequestItem> {
  return apiFetch(`/api/admin/access-requests/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify({ ttlMinutes }) });
}

export function denyAccessRequestApi(id: string, reason: string): Promise<AccessRequestItem> {
  return apiFetch(`/api/admin/access-requests/${encodeURIComponent(id)}/deny`, { method: "POST", body: JSON.stringify({ reason }) });
}

export function revokeAccessRequestApi(id: string): Promise<AccessRequestItem> {
  return apiFetch(`/api/admin/access-requests/${encodeURIComponent(id)}/revoke`, { method: "POST" });
}

export function giveUpAccessRequestApi(id: string): Promise<AccessRequestItem> {
  return apiFetch(`/api/access-requests/${encodeURIComponent(id)}/give-up`, { method: "POST" });
}

// ---------- SIEM export (full-admin only) ----------

export interface SiemConfigView {
  enabled: boolean;
  webhookUrl: string;
  secretSet: boolean;
  secretPreview: string;
  updatedAt: number | null;
  updatedBy: string | null;
}

export interface SiemDeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export function fetchSiemConfig(): Promise<SiemConfigView> {
  return apiFetch("/api/admin/siem-config");
}

export function saveSiemConfig(changes: { enabled: boolean; webhookUrl: string; secret?: string }): Promise<SiemConfigView> {
  return apiFetch("/api/admin/siem-config", { method: "POST", body: JSON.stringify(changes) });
}

export function testSiemConfig(): Promise<SiemDeliveryResult> {
  return apiFetch("/api/admin/siem-config/test", { method: "POST" });
}
