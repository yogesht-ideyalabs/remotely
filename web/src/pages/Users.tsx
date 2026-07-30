import { useEffect, useMemo, useState } from "react";
import {
  fetchUsers,
  fetchRoles,
  fetchOrganizations,
  createUserApi,
  updateUserApi,
  deleteUserApi,
  logoutUserEverywhereApi,
  getSession,
  type AdminUser,
  type Role,
  type Organization,
} from "../api";
import { useOrgFilter } from "../OrgContext";
import { FieldLabel } from "../components/FieldLabel";
import { Skeleton } from "../components/Skeleton";

export default function Users() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", roles: [] as string[], tenant: "" });
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ tenant: "", password: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState("");
  const session = getSession();
  const { selected: selectedOrg } = useOrgFilter();

  const visibleUsers = useMemo(() => {
    if (!users) return null;
    return selectedOrg ? users.filter((u) => u.tenant === selectedOrg) : users;
  }, [users, selectedOrg]);

  function load() {
    fetchUsers().then(setUsers).catch((e) => setError(e.message));
    // Full role catalog is full-admin-only; a delegated admin still manages
    // users, just can't browse/assign arbitrary roles — fall back quietly.
    fetchRoles()
      .then(setRoles)
      .catch(() => setRoles([]));
    fetchOrganizations()
      .then(setOrgs)
      .catch(() => setOrgs([]));
  }
  useEffect(load, []);

  function toggleRole(name: string) {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(name) ? f.roles.filter((r) => r !== name) : [...f.roles, name],
    }));
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createUserApi(form.username, form.password, form.roles, form.tenant);
      setForm({ username: "", password: "", roles: [], tenant: "" });
      setCreating(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    }
  }

  async function toggleUserRole(user: AdminUser, roleName: string) {
    const newRoles = user.roles.includes(roleName)
      ? user.roles.filter((r) => r !== roleName)
      : [...user.roles, roleName];
    try {
      await updateUserApi(user.username, { roles: newRoles });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "update failed");
    }
  }

  function startEditUser(u: AdminUser) {
    setEditingUser(u.username);
    setEditForm({ tenant: u.tenant, password: "" });
  }

  async function saveEditUser(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    setError(null);
    try {
      await updateUserApi(editingUser, {
        tenant: editForm.tenant,
        ...(editForm.password ? { password: editForm.password } : {}),
      });
      setEditingUser(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "update failed");
    }
  }

  async function logoutEverywhere(username: string) {
    if (!confirm(`Log "${username}" out everywhere? Their password stays the same, but every active session/token is revoked immediately.`)) return;
    setError(null);
    try {
      await logoutUserEverywhereApi(username);
    } catch (err) {
      setError(err instanceof Error ? err.message : "logout failed");
    }
  }

  async function removeUser(username: string) {
    if (!confirm(`Delete user "${username}"?`)) return;
    try {
      await deleteUserApi(username);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  function toggleSelected(username: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!visibleUsers) return;
    setSelected((s) => (s.size === visibleUsers.length ? new Set() : new Set(visibleUsers.map((u) => u.username))));
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} selected user(s)?`)) return;
    setError(null);
    try {
      await Promise.all(Array.from(selected).map((u) => deleteUserApi(u)));
      setSelected(new Set());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "bulk delete failed");
    }
  }

  async function bulkRoleChange(add: boolean) {
    if (!bulkRole || !users) return;
    setError(null);
    try {
      await Promise.all(
        Array.from(selected).map((username) => {
          const u = users.find((x) => x.username === username)!;
          const newRoles = add ? Array.from(new Set([...u.roles, bulkRole])) : u.roles.filter((r) => r !== bulkRole);
          return updateUserApi(username, { roles: newRoles });
        })
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "bulk role update failed");
    }
  }

  return (
    <div>
      <div className="page-header-row">
        <div>
          <h2 className="page-title">Users</h2>
          <p className="page-sub">
            Manage users and role assignments. Permissions = union of all assigned roles.
            {!session?.isAdmin && session?.isDelegatedAdmin && " (Delegated admin: scoped to your org)"}
          </p>
        </div>
        {!creating && (
          <button className="primary" style={{ width: "auto", padding: "8px 16px" }} onClick={() => setCreating(true)}>
            + New User
          </button>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}

      {creating && (
        <form className="section-card" onSubmit={createUser}>
          <h3>New user</h3>
          <div className="form-row">
            <div>
              <FieldLabel label="Username">
                The login name this person signs in with — must be unique. Not an email address unless you want it
                to be; it's just an identifier.
              </FieldLabel>
              <input
                placeholder="username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div>
              <FieldLabel label="Password">
                Their initial login password — they can change it later from their own Profile page. Choose
                something you can hand off securely, not a permanent shared secret.
              </FieldLabel>
              <input
                placeholder="password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div>
              <FieldLabel label="Organization">
                Which tenant this user belongs to — find it on the <b>Organizations</b> page. Determines what a
                delegated admin for that org can see/manage about this user; leave unset for a full-admin-only
                account.
              </FieldLabel>
              <select value={form.tenant} onChange={(e) => setForm({ ...form, tenant: e.target.value })}>
                <option value="">— no organization —</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <FieldLabel label="Roles">
            Permissions are the union of every assigned role's allows, minus any of their denies — assign as many as
            apply. Find exact role names and what each one actually grants on the <b>Roles</b> page.
          </FieldLabel>
          <div className="tag-input-list">
            {roles.length === 0 && <div className="hint">No role catalog visible to you — ask a full admin for the exact role name.</div>}
            {roles.map((r) => (
              <button
                type="button"
                key={r.name}
                className="tag-chip"
                style={{
                  border: form.roles.includes(r.name) ? "1px solid var(--accent)" : "1px solid transparent",
                  cursor: "pointer",
                }}
                onClick={() => toggleRole(r.name)}
              >
                {form.roles.includes(r.name) ? "✓ " : ""}
                {r.name}
              </button>
            ))}
          </div>
          <div className="form-row">
            <button className="primary" style={{ width: "auto", padding: "8px 20px" }}>
              Create
            </button>
            <button type="button" className="secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {!creating && (
        <button className="secondary" style={{ marginBottom: 16 }} onClick={() => setCreating(true)}>
          + New user
        </button>
      )}

      {editingUser && (
        <form className="section-card" onSubmit={saveEditUser}>
          <h3>Edit {editingUser}</h3>
          <div className="form-row">
            <div>
              <FieldLabel label="Organization">
                Which tenant this user belongs to — find it on the <b>Organizations</b> page.
              </FieldLabel>
              <select value={editForm.tenant} onChange={(e) => setEditForm({ ...editForm, tenant: e.target.value })}>
                <option value="">— no organization —</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel label="New password">
                Leave blank to keep their current password unchanged — only fill this in to force a reset.
              </FieldLabel>
              <input
                placeholder="new password (leave blank to keep)"
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
              />
            </div>
          </div>
          <div className="form-row">
            <button className="primary" style={{ width: "auto", padding: "8px 20px" }}>
              Save
            </button>
            <button type="button" className="secondary" onClick={() => setEditingUser(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {selected.size > 0 && (
        <div className="section-card" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <b style={{ fontSize: 12 }}>{selected.size} selected</b>
          {roles.length > 0 && (
            <>
              <select value={bulkRole} onChange={(e) => setBulkRole(e.target.value)} style={{ width: "auto" }}>
                <option value="">— pick a role —</option>
                {roles.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button className="secondary" disabled={!bulkRole} onClick={() => bulkRoleChange(true)}>
                Add role to selected
              </button>
              <button className="secondary" disabled={!bulkRole} onClick={() => bulkRoleChange(false)}>
                Remove role from selected
              </button>
            </>
          )}
          <button className="danger-link" onClick={bulkDelete}>
            Delete selected
          </button>
          <button className="link" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {!visibleUsers && <Skeleton lines={4} />}
      {visibleUsers && (
        <div className="admin-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={selected.size > 0 && selected.size === visibleUsers.length} onChange={toggleSelectAll} />
                </th>
                <th>Username</th>
                <th>Organization</th>
                <th>Roles{roles.length > 0 ? " (click to toggle)" : ""}</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((u) => (
                <tr key={u.username}>
                  <td>
                    <input type="checkbox" checked={selected.has(u.username)} onChange={() => toggleSelected(u.username)} />
                  </td>
                  <td>{u.username}</td>
                  <td>{orgs.find((o) => o.id === u.tenant)?.name ?? u.tenant ?? "—"}</td>
                  <td>
                    <div className="pill-list">
                      {roles.length > 0
                        ? roles.map((r) => (
                            <button
                              key={r.name}
                              className="tag-chip"
                              style={{ opacity: u.roles.includes(r.name) ? 1 : 0.35, cursor: "pointer" }}
                              onClick={() => toggleUserRole(u, r.name)}
                            >
                              {r.name}
                            </button>
                          ))
                        : u.roles.map((r) => (
                            <span key={r} className="tag-chip">
                              {r}
                            </span>
                          ))}
                    </div>
                  </td>
                  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td>
                    <div className="row-actions">
                      <button className="link" onClick={() => startEditUser(u)}>
                        Edit
                      </button>
                      <button className="link" onClick={() => logoutEverywhere(u.username)}>
                        Log out everywhere
                      </button>
                      <button className="danger-link" onClick={() => removeUser(u.username)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
