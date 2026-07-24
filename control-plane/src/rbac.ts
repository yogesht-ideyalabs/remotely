import type { Role, AuditEvent } from "./store.js";
import { listUsers, listConnections } from "./store.js";
import { ipInCidr } from "./cidr.js";

export interface ResourceLike {
  labels: Record<string, string>;
  type: string;
  // Direct per-user grants (Connection.assignedUsers) — usernames who can
  // access this resource regardless of role-based allow rules. Absent for
  // resource kinds that don't support direct assignment (ssh-agent).
  assignedUsers?: string[];
}

function isRoleActive(role: Role): boolean {
  if (!role.expiresAt) return true;
  return Date.now() < new Date(role.expiresAt).getTime();
}

// Every key in the pattern must match one of its allowed values on the
// resource. An empty pattern object never matches here — callers treat an
// empty allowLabels as the separate "wildcard" case.
function labelPatternMatches(pattern: Record<string, string[]>, labels: Record<string, string>): boolean {
  const entries = Object.entries(pattern);
  if (entries.length === 0) return false;
  return entries.every(([key, values]) => values.includes(labels[key]));
}

export function activeRoles(roles: Role[]): Role[] {
  return roles.filter(isRoleActive);
}

// "Allow anywhere, deny everywhere wins" — same model as Teleport: a
// resource is visible if ANY active role's allow rules match it (and its
// resource-type scope), OR the user was directly assigned it (see
// Connection.assignedUsers — a plain "share this with them" grant that
// bypasses role/label matching entirely), UNLESS ANY active role's deny
// rules also match it. Deny always wins, even over a direct assignment —
// an explicit block should never be quietly overridden by a share.
export function canAccessResource(roles: Role[], resource: ResourceLike, username?: string): boolean {
  const active = activeRoles(roles);

  const allowedByRole = active.some((role) => {
    const typeOk = role.resourceTypes.length === 0 || role.resourceTypes.includes(resource.type);
    if (!typeOk) return false;
    const isWildcard = Object.keys(role.allowLabels).length === 0;
    return isWildcard || labelPatternMatches(role.allowLabels, resource.labels);
  });
  const allowedByAssignment = Boolean(username && resource.assignedUsers?.includes(username));
  if (!allowedByRole && !allowedByAssignment) return false;

  const denied = active.some(
    (role) => Object.keys(role.denyLabels).length > 0 && labelPatternMatches(role.denyLabels, resource.labels)
  );
  return !denied;
}

export function loginAllowed(roles: Role[], login: string): boolean {
  return activeRoles(roles).some((role) => role.logins.includes(login));
}

// The strictest (smallest) TTL among active roles wins. null = unlimited.
export function effectiveSessionTTLMinutes(roles: Role[]): number | null {
  const ttls = activeRoles(roles)
    .map((r) => r.maxSessionTTLMinutes)
    .filter((t): t is number => Boolean(t) && t > 0);
  return ttls.length === 0 ? null : Math.min(...ttls);
}

// A role with no CIDR list imposes no restriction. A role WITH one requires
// the client IP to fall inside it — every such role's rule must be
// satisfied (not just one), so stacking a stricter role actually narrows
// access rather than being shadowed by a looser one.
export function ipAllowed(roles: Role[], ip: string): boolean {
  return activeRoles(roles).every((role) => role.allowedCIDRs.length === 0 || role.allowedCIDRs.some((c) => ipInCidr(ip, c)));
}

// Most-restrictive-wins, same pattern as CIDR: one role saying "no
// clipboard" blocks it for the session even if another role would allow it.
export function clipboardAllowed(roles: Role[]): boolean {
  return activeRoles(roles).every((role) => role.allowClipboard);
}

export function isFullAdmin(roles: Role[]): boolean {
  return roles.some((r) => r.name === "admin");
}

// Full admin OR a delegated/tenant admin (any active role with non-empty
// manageLabels) — the same "any kind of admin" test requireAnyAdmin in
// index.ts uses to gate admin-only routes, factored out so /api/notifications
// can apply the identical rule when deciding whether to scope by tenant or
// fall back to "your own events only".
export function isAnyAdmin(roles: Role[]): boolean {
  return isFullAdmin(roles) || roles.some((r) => Object.keys(r.manageLabels).length > 0);
}

// Break-glass self-approval eligibility — deliberately its own predicate
// (not folded into isFullAdmin) since it's meant for a specific on-call/
// emergency-responder role, not "any admin," and a role can grant it
// without granting admin at all.
export function activeRolesEligibleForBreakGlass(roles: Role[]): boolean {
  return activeRoles(roles).some((r) => r.breakGlassEligible);
}

// Delegated/tenant admin: a role's manageLabels grants admin-lite access
// (create/edit/delete users + connections) scoped to whatever labels it
// names, without needing the full "admin" role. Real MSP "delegated
// administration" — a client's own admin can manage their own tenant's
// users/connections but never sees or touches another tenant's, and can't
// touch the underlying role/permission model at all.
export function canManageResource(roles: Role[], resourceLabels: Record<string, string>): boolean {
  if (isFullAdmin(roles)) return true;
  return activeRoles(roles).some(
    (role) => Object.keys(role.manageLabels).length > 0 && labelPatternMatches(role.manageLabels, resourceLabels)
  );
}

// Same idea applied to a user's tenant instead of a resource's labels —
// lets a delegated admin manage other users within their own tenant.
export function canManageTenant(roles: Role[], tenant: string): boolean {
  if (isFullAdmin(roles)) return true;
  return activeRoles(roles).some((role) => {
    const values = role.manageLabels.client;
    return values !== undefined && values.includes(tenant);
  });
}

// The set of tenant values ("client" label) a delegated admin's manageLabels
// cover, used to scope list endpoints. Empty array + isFullAdmin=false means
// "manages nothing" (a plain access role); empty array + isFullAdmin=true
// means "sees everything" (handled separately by callers).
export function manageableTenants(roles: Role[]): string[] {
  return activeRoles(roles).flatMap((role) => role.manageLabels.client ?? []);
}

// Shared "which audit events is this caller allowed to see" rule — a full
// admin sees everything, a delegated admin sees events about users/
// connections within their own manageLabels scope, same as /api/audit and
// /api/admin/dashboard already did independently before this was factored
// out. Returns a predicate rather than a filtered list so callers can reuse
// it against differently-shaped event-like objects (or apply it lazily).
export function auditEventInScope(roles: Role[]): (event: Pick<AuditEvent, "username" | "resourceId">) => boolean {
  if (isFullAdmin(roles)) return () => true;
  const tenantUsernames = new Set(listUsers().filter((u) => canManageTenant(roles, u.tenant)).map((u) => u.username));
  const scopedConnectionIds = new Set(listConnections().filter((c) => canManageResource(roles, c.labels)).map((c) => c.id));
  return (event) => tenantUsernames.has(event.username) || (event.resourceId !== null && scopedConnectionIds.has(event.resourceId));
}

import { getRole as _getRole } from "./store.js";
export { getRole, getRolesForUser } from "./store.js";

export function resolveRoles(roleNames: string[]): Role[] {
  return roleNames.map(_getRole).filter((r): r is Role => Boolean(r));
}
