import type {
  Session,
  MfaChallenge,
  Resource,
  AuditEvent,
  AdminUser,
  Role,
  Connection,
  Organization,
  AccessRequestItem,
  AccessRequestStatus,
} from "./types.js";

export interface RemotelyClientOptions {
  /** e.g. "http://localhost:4000" — no trailing slash needed */
  baseUrl: string;
  /** A session token from a previous login(), if you're resuming a session rather than starting one */
  token?: string;
}

export class RemotelyApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `request failed (${status})`);
    this.name = "RemotelyApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Client for the Remotely control-plane REST API.
 *
 * Deliberately environment-agnostic (no localStorage/window dependency,
 * unlike the web app's own internal api.ts) — usable from Node scripts,
 * CI jobs, or a browser equally. Callers own token persistence; this class
 * just holds the token in memory and attaches it to requests.
 *
 * Scope note: this wraps the REST surface (auth, resources, users, roles,
 * connections, organizations, access requests, audit). It does NOT wrap
 * the WebSocket session protocols (interactive SSH/RDP/database sessions,
 * live co-watching) — those are a different, stateful, binary-framed
 * protocol; see cli/src/ssh.ts for a real reference implementation of that
 * side if you need it. Anything else not explicitly wrapped below is
 * reachable via the generic `request()` escape hatch.
 */
export class RemotelyClient {
  private baseUrl: string;
  private token?: string;

  constructor(options: RemotelyClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
  }

  setToken(token: string): void {
    this.token = token;
  }

  getToken(): string | undefined {
    return this.token;
  }

  /** Generic escape hatch for any endpoint not explicitly wrapped below. */
  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: res.statusText }));
      throw new RemotelyApiError(res.status, errBody);
    }
    if (res.status === 204) return null as T;
    return (await res.json()) as T;
  }

  // ---------- auth ----------

  /** On success (no MFA), also stores the token on this client for subsequent calls. */
  async login(username: string, password: string): Promise<Session | MfaChallenge> {
    const result = await this.request<Session | MfaChallenge>("POST", "/api/login", { username, password });
    if ("token" in result) this.token = result.token;
    return result;
  }

  async verifyLoginMfa(mfaToken: string, code: string): Promise<Session> {
    const session = await this.request<Session>("POST", "/api/login/verify-mfa", { mfaToken, code });
    this.token = session.token;
    return session;
  }

  me(): Promise<{ username: string; roles: string[]; isAdmin: boolean; isDelegatedAdmin: boolean }> {
    return this.request("GET", "/api/me");
  }

  // ---------- resources ----------

  listResources(): Promise<Resource[]> {
    return this.request("GET", "/api/resources");
  }

  // ---------- users (admin) ----------

  listUsers(): Promise<AdminUser[]> {
    return this.request("GET", "/api/admin/users");
  }
  createUser(username: string, password: string, roles: string[], tenant: string): Promise<AdminUser> {
    return this.request("POST", "/api/admin/users", { username, password, roles, tenant });
  }
  updateUser(username: string, changes: { roles?: string[]; password?: string; tenant?: string }): Promise<AdminUser> {
    return this.request("PATCH", `/api/admin/users/${encodeURIComponent(username)}`, changes);
  }
  deleteUser(username: string): Promise<null> {
    return this.request("DELETE", `/api/admin/users/${encodeURIComponent(username)}`);
  }

  // ---------- roles (admin) ----------

  listRoles(): Promise<Role[]> {
    return this.request("GET", "/api/admin/roles");
  }
  createRole(role: Role): Promise<Role> {
    return this.request("POST", "/api/admin/roles", role);
  }
  updateRole(name: string, role: Partial<Role>): Promise<Role> {
    return this.request("PATCH", `/api/admin/roles/${encodeURIComponent(name)}`, role);
  }
  deleteRole(name: string): Promise<null> {
    return this.request("DELETE", `/api/admin/roles/${encodeURIComponent(name)}`);
  }

  // ---------- connections (admin) ----------

  listConnections(): Promise<Connection[]> {
    return this.request("GET", "/api/admin/connections");
  }
  createConnection(conn: Partial<Connection>): Promise<Connection> {
    return this.request("POST", "/api/admin/connections", conn);
  }
  updateConnection(id: string, conn: Partial<Connection>): Promise<Connection> {
    return this.request("PATCH", `/api/admin/connections/${encodeURIComponent(id)}`, conn);
  }
  deleteConnection(id: string): Promise<null> {
    return this.request("DELETE", `/api/admin/connections/${encodeURIComponent(id)}`);
  }

  // ---------- organizations (admin) ----------

  listOrganizations(): Promise<Organization[]> {
    return this.request("GET", "/api/admin/organizations");
  }
  createOrganization(id: string, name: string): Promise<Organization> {
    return this.request("POST", "/api/admin/organizations", { id, name });
  }
  updateOrganization(id: string, changes: Partial<Organization>): Promise<Organization> {
    return this.request("PATCH", `/api/admin/organizations/${encodeURIComponent(id)}`, changes);
  }
  deleteOrganization(id: string, force = false): Promise<null> {
    return this.request("DELETE", `/api/admin/organizations/${encodeURIComponent(id)}${force ? "?force=true" : ""}`);
  }

  // ---------- access requests ----------

  createAccessRequest(resourceId: string, login: string, reason: string, breakGlass = false): Promise<AccessRequestItem> {
    return this.request("POST", "/api/access-requests", { resourceId, login, reason, breakGlass });
  }
  myAccessRequests(): Promise<AccessRequestItem[]> {
    return this.request("GET", "/api/my-access-requests");
  }
  adminAccessRequests(status?: AccessRequestStatus): Promise<AccessRequestItem[]> {
    return this.request("GET", `/api/admin/access-requests${status ? `?status=${status}` : ""}`);
  }
  approveAccessRequest(id: string, ttlMinutes: number): Promise<AccessRequestItem> {
    return this.request("POST", `/api/admin/access-requests/${encodeURIComponent(id)}/approve`, { ttlMinutes });
  }
  denyAccessRequest(id: string, reason: string): Promise<AccessRequestItem> {
    return this.request("POST", `/api/admin/access-requests/${encodeURIComponent(id)}/deny`, { reason });
  }
  revokeAccessRequest(id: string): Promise<AccessRequestItem> {
    return this.request("POST", `/api/admin/access-requests/${encodeURIComponent(id)}/revoke`);
  }
  giveUpAccessRequest(id: string): Promise<AccessRequestItem> {
    return this.request("POST", `/api/access-requests/${encodeURIComponent(id)}/give-up`);
  }

  // ---------- audit ----------

  auditLog(): Promise<AuditEvent[]> {
    return this.request("GET", "/api/audit");
  }
}
