// Groups the ~49 distinct audit eventType strings the control plane
// actually emits (grepped from every logAudit(...) call site, not
// guessed) into categories an admin would actually filter by. Purely a
// frontend display concern — the backend doesn't know "categories" exist,
// it just emits flat eventType strings.

export interface AuditCategory {
  id: string;
  label: string;
  eventTypes: string[];
}

export const AUDIT_CATEGORIES: AuditCategory[] = [
  {
    id: "auth",
    label: "Authentication & Credentials",
    eventTypes: [
      "login",
      "login_failed",
      "login_mfa_pending",
      "sso_user_provisioned",
      "password_changed",
      "mfa_enabled",
      "mfa_disabled",
      "passkey_added",
      "passkey_removed",
      "ssh_key_added",
      "ssh_key_deleted",
    ],
  },
  {
    id: "access",
    label: "Access Control",
    eventTypes: [
      "access_denied",
      "access_request_created",
      "access_request_approved",
      "access_request_denied",
      "access_request_revoked",
      "access_request_break_glass",
    ],
  },
  {
    id: "sessions",
    label: "Sessions",
    eventTypes: [
      "session_start",
      "session_end",
      "session_error",
      "session_ttl_expired",
      "session_terminated_by_admin",
      "session_watched",
      "session_login_status",
    ],
  },
  {
    id: "files",
    label: "File Transfer",
    eventTypes: ["file_download", "file_upload"],
  },
  {
    id: "database",
    label: "Database Queries",
    eventTypes: ["db_query"],
  },
  {
    id: "users-roles",
    label: "User & Role Management",
    eventTypes: ["user_created", "user_updated", "user_deleted", "role_created", "role_updated", "role_deleted"],
  },
  {
    id: "connections-orgs",
    label: "Connections & Organizations",
    eventTypes: [
      "connection_created",
      "connection_updated",
      "connection_deleted",
      "organization_created",
      "organization_updated",
      "organization_deleted",
      "folder_assigned",
    ],
  },
  {
    id: "agents-tokens",
    label: "Agents & Join Tokens",
    eventTypes: ["agent_joined", "agent_join_denied", "agent_update_triggered", "join_token_created", "join_token_revoked"],
  },
  {
    id: "platform",
    label: "Platform Settings",
    eventTypes: ["recording_deleted", "siem_config_updated", "siem_test_sent"],
  },
];

const EVENT_TYPE_TO_CATEGORY = new Map<string, AuditCategory>();
for (const category of AUDIT_CATEGORIES) {
  for (const eventType of category.eventTypes) EVENT_TYPE_TO_CATEGORY.set(eventType, category);
}

const UNCATEGORIZED: AuditCategory = { id: "other", label: "Other", eventTypes: [] };

export function categoryForEventType(eventType: string): AuditCategory {
  return EVENT_TYPE_TO_CATEGORY.get(eventType) ?? UNCATEGORIZED;
}
