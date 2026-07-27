// Mirrors the shapes the control plane's REST API actually returns —
// kept in sync by hand against control-plane/src/store.ts and web/src/api.ts,
// since there's no shared schema package between the three. If a field
// looks off, check those two first.

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

export interface Resource {
  id: string;
  hostname: string;
  labels: Record<string, string>;
  folder: string;
  type: string;
  connectedAt: number;
}

export interface AuditEvent {
  id: string;
  ts: number;
  username: string;
  eventType: string;
  resourceId: string | null;
  details: string;
}

export interface AdminUser {
  username: string;
  roles: string[];
  tenant: string;
  createdAt: number;
}

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

export interface Organization {
  id: string;
  name: string;
  createdAt: number;
  brandName?: string;
  brandColor?: string;
  logoDataUri?: string;
}

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
