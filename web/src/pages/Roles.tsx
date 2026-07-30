import { useEffect, useMemo, useState } from "react";
import { fetchRoles, createRoleApi, updateRoleApi, deleteRoleApi, type Role } from "../api";
import { FieldLabel } from "../components/FieldLabel";
import { LabelChips } from "../components/LabelChips";
import { Skeleton } from "../components/Skeleton";

const emptyForm = {
  name: "",
  description: "",
  category: "",
  allowLabelsJson: "{}",
  denyLabelsJson: "{}",
  resourceTypes: "",
  logins: "demo",
  maxSessionTTLMinutes: "480",
  allowedCIDRs: "",
  expiresAt: "",
  manageLabelsJson: "{}",
  allowClipboard: true,
  breakGlassEligible: false,
  requireSessionModeration: false,
  canModerate: false,
};

export default function Roles() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // role name being edited, or "" for new
  const [form, setForm] = useState(emptyForm);

  function load() {
    fetchRoles().then(setRoles).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  const groups = useMemo(() => {
    if (!roles) return null;
    const byCategory = new Map<string, Role[]>();
    for (const r of roles) {
      const key = r.category || "Uncategorized";
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(r);
    }
    return Array.from(byCategory.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [roles]);

  function startCreate() {
    setForm(emptyForm);
    setEditing("");
  }

  function startEdit(role: Role) {
    setForm({
      name: role.name,
      description: role.description,
      category: role.category ?? "",
      allowLabelsJson: JSON.stringify(role.allowLabels, null, 0),
      denyLabelsJson: JSON.stringify(role.denyLabels, null, 0),
      resourceTypes: role.resourceTypes.join(", "),
      logins: role.logins.join(", "),
      maxSessionTTLMinutes: String(role.maxSessionTTLMinutes),
      allowedCIDRs: role.allowedCIDRs.join(", "),
      expiresAt: role.expiresAt ?? "",
      manageLabelsJson: JSON.stringify(role.manageLabels ?? {}),
      allowClipboard: role.allowClipboard ?? true,
      breakGlassEligible: role.breakGlassEligible ?? false,
      requireSessionModeration: role.requireSessionModeration ?? false,
      canModerate: role.canModerate ?? false,
    });
    setEditing(role.name);
  }

  function csv(s: string): string[] {
    return s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let allowLabels, denyLabels, manageLabels;
    try {
      allowLabels = JSON.parse(form.allowLabelsJson || "{}");
      denyLabels = JSON.parse(form.denyLabelsJson || "{}");
      manageLabels = JSON.parse(form.manageLabelsJson || "{}");
    } catch {
      setError("allow/deny/manage labels must be valid JSON, e.g. {\"client\":[\"acme-corp\"]}");
      return;
    }
    const payload = {
      name: form.name,
      description: form.description,
      category: form.category,
      allowLabels,
      denyLabels,
      resourceTypes: csv(form.resourceTypes),
      logins: csv(form.logins),
      maxSessionTTLMinutes: Number(form.maxSessionTTLMinutes) || 0,
      allowedCIDRs: csv(form.allowedCIDRs),
      expiresAt: form.expiresAt || null,
      manageLabels,
      allowClipboard: form.allowClipboard,
      breakGlassEligible: form.breakGlassEligible,
      requireSessionModeration: (form as any).requireSessionModeration || false,
      canModerate: (form as any).canModerate || false,
    };
    try {
      if (editing === "") {
        await createRoleApi(payload as Role);
      } else if (editing) {
        await updateRoleApi(editing, payload);
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    }
  }

  async function remove(name: string) {
    if (!confirm(`Delete role "${name}"? Users still assigned it simply lose whatever it granted.`)) return;
    try {
      await deleteRoleApi(name);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  return (
    <div>
      <h2 className="page-title">Roles</h2>
      <p className="page-sub">
        Every permission dimension is enforced server-side on connect: label allow/deny, resource type, login
        allowlist, session TTL, and source-IP CIDR. Grouped by category, purely for organizing this list.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {editing !== null && (
        <form className="section-card" onSubmit={save}>
          <h3>{editing === "" ? "New role" : `Edit ${editing}`}</h3>
          <div className="form-row">
            <div>
              <FieldLabel label="Name">
                Unique identifier for this role, e.g. <b>client-acme-corp-access</b>. Used internally when assigning
                it to users — pick something that describes who or what it's for. Can't be changed after creation.
              </FieldLabel>
              <input
                placeholder="role name"
                value={form.name}
                disabled={editing !== ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div style={{ minWidth: 260 }}>
              <FieldLabel label="Description">
                Shown to admins on this list, next to the role's name. Purely informational — has no effect on
                access.
              </FieldLabel>
              <input
                placeholder="description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <FieldLabel label="Category">
                Groups roles together on this page, e.g. <b>Acme Corp</b>, <b>Admin</b>. Purely organizational — has
                no effect on access.
              </FieldLabel>
              <input
                placeholder="category, e.g. Acme Corp"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </div>
          </div>
          <div className="form-row">
            <div style={{ flex: 1, minWidth: 260 }}>
              <FieldLabel label="Allow labels">
                JSON object, label key → array of allowed values, e.g. <b>{'{"client":["acme-corp"]}'}</b>. A
                resource is visible to this role only if every listed key matches one of its values. Leave as{" "}
                <b>{"{}"}</b> to match every resource regardless of labels (a wildcard) — combine carefully with
                Resource types below, since an unrestricted Allow + unrestricted Resource types grants access to
                literally everything.
              </FieldLabel>
              <input
                value={form.allowLabelsJson}
                onChange={(e) => setForm({ ...form, allowLabelsJson: e.target.value })}
              />
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <FieldLabel label="Deny labels">
                Same JSON shape as Allow labels. If a resource matches here, it's blocked for this role no matter
                what Allow labels or a direct per-user assignment say — <b>deny always wins</b>, no exceptions.
              </FieldLabel>
              <input
                value={form.denyLabelsJson}
                onChange={(e) => setForm({ ...form, denyLabelsJson: e.target.value })}
              />
            </div>
          </div>
          <div className="form-row">
            <div>
              <FieldLabel label="Resource types">
                Comma-separated: <b>ssh-agent, ssh-direct, rdp, vnc, database, kubernetes</b>. Restricts which kinds
                of resource this role can reach at all, on top of the Allow/Deny label rules above. Leave empty to
                allow every type.
              </FieldLabel>
              <input value={form.resourceTypes} onChange={(e) => setForm({ ...form, resourceTypes: e.target.value })} />
            </div>
            <div>
              <FieldLabel label="Allowed logins">
                Comma-separated usernames, e.g. <b>demo, root</b>. A connection's own configured login must appear
                here or the session is refused, even if the resource itself is otherwise visible to this role.
              </FieldLabel>
              <input value={form.logins} onChange={(e) => setForm({ ...form, logins: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div style={{ flex: 1, minWidth: 260 }}>
              <FieldLabel label="Delegated admin scope">
                Same JSON shape as Allow labels. Leave as <b>{"{}"}</b> for a normal access-only role. Any non-empty
                value turns this into a <b>delegated admin</b> role: holders can create/edit/delete users and
                connections whose labels match this pattern, without needing the full "admin" role. This is a real
                admin capability, not just resource access — set it deliberately.
              </FieldLabel>
              <input value={form.manageLabelsJson} onChange={(e) => setForm({ ...form, manageLabelsJson: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={form.allowClipboard}
                onChange={(e) => setForm({ ...form, allowClipboard: e.target.checked })}
                style={{ width: "auto", margin: 0 }}
              />
              Allow clipboard in RDP sessions
              <span className="field-tip" tabIndex={0}>
                <span className="field-tip-icon">i</span>
                <span className="field-tip-popover">
                  Only affects RDP sessions — doesn't change anything for SSH or database sessions. Unchecked blocks
                  copy/paste in both directions between the local machine and the remote desktop.
                </span>
              </span>
            </label>
          </div>
          <div className="form-row">
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={form.breakGlassEligible}
                onChange={(e) => setForm({ ...form, breakGlassEligible: e.target.checked })}
                style={{ width: "auto", margin: 0 }}
              />
              Break-glass eligible
              <span className="field-tip" tabIndex={0}>
                <span className="field-tip-icon">i</span>
                <span className="field-tip-popover">
                  Lets a holder submit an access request marked "break-glass" and have it self-approved immediately,
                  skipping the normal admin approval queue — for genuine emergencies. Still fully logged in the audit
                  trail and approval history either way, and the grant expires automatically after a short fixed
                  window rather than staying open indefinitely.
                </span>
              </span>
            </label>
          </div>
          <div className="form-row">
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={(form as any).requireSessionModeration || false}
                onChange={(e) => setForm({ ...form, requireSessionModeration: e.target.checked } as any)}
                style={{ width: "auto", margin: 0 }}
              />
              Require session moderation
              <span className="field-tip" tabIndex={0}>
                <span className="field-tip-icon">i</span>
                <span className="field-tip-popover">
                  If checked, any session this role covers will NOT start until a moderator (a user whose role has
                  "Can moderate" checked) joins the session's watch channel. The session enters a waiting state
                  and the user sees "Waiting for moderator..." until one joins. Times out after 5 minutes if no
                  moderator appears.
                </span>
              </span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={(form as any).canModerate || false}
                onChange={(e) => setForm({ ...form, canModerate: e.target.checked } as any)}
                style={{ width: "auto", margin: 0 }}
              />
              Can moderate sessions
              <span className="field-tip" tabIndex={0}>
                <span className="field-tip-icon">i</span>
                <span className="field-tip-popover">
                  Lets users with this role act as moderators for sessions that require moderation. They'll see
                  pending sessions on the Active Sessions page and can join to release the hold. They can also
                  forcibly terminate moderated sessions at any time.
                </span>
              </span>
            </label>
          </div>
          <div className="form-row">
            <div>
              <FieldLabel label="Max session TTL">
                Minutes a single session can stay open before it's force-disconnected, regardless of activity.{" "}
                <b>0 = unlimited</b> — sessions stay open until the user disconnects.
              </FieldLabel>
              <input
                type="number"
                value={form.maxSessionTTLMinutes}
                onChange={(e) => setForm({ ...form, maxSessionTTLMinutes: e.target.value })}
              />
            </div>
            <div>
              <FieldLabel label="Allowed source CIDRs">
                Comma-separated IP ranges, e.g. <b>10.0.0.0/8, 203.0.113.4/32</b>. The connecting user's own IP must
                fall inside one of these for this role's access to apply. Leave empty to allow any source IP.
              </FieldLabel>
              <input value={form.allowedCIDRs} onChange={(e) => setForm({ ...form, allowedCIDRs: e.target.value })} />
            </div>
            <div>
              <FieldLabel label="Expires at">
                This role itself stops granting anything after this date — existing assignments aren't removed, they
                just become inert. Leave empty for a role that never expires on its own.
              </FieldLabel>
              <input
                type="date"
                value={form.expiresAt.slice(0, 10)}
                onChange={(e) => setForm({ ...form, expiresAt: e.target.value ? new Date(e.target.value).toISOString() : "" })}
              />
            </div>
          </div>
          <div className="form-row">
            <button className="primary" style={{ width: "auto", padding: "8px 20px" }}>
              Save
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {editing === null && (
        <button className="secondary" style={{ marginBottom: 16 }} onClick={startCreate}>
          + New role
        </button>
      )}

      {!groups && <Skeleton lines={4} />}
      {groups &&
        groups.map(([category, items]) => (
          <div key={category} style={{ marginBottom: 28 }}>
            <h3 style={{ fontSize: 13, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
              {category} <span style={{ opacity: 0.6 }}>({items.length})</span>
            </h3>
            <div className="admin-table-wrap">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Allow</th>
                    <th>Deny</th>
                    <th>Types</th>
                    <th>Logins</th>
                    <th>TTL (min)</th>
                    <th>CIDRs</th>
                    <th>Expires</th>
                    <th>Manages (delegated admin)</th>
                    <th>RDP Clipboard</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.name}>
                      <td>
                        <b>{r.name}</b>
                        <div className="hint">{r.description}</div>
                      </td>
                      <td>{Object.keys(r.allowLabels).length === 0 ? "* (all)" : <LabelChips labels={r.allowLabels} />}</td>
                      <td>{Object.keys(r.denyLabels).length === 0 ? "—" : <LabelChips labels={r.denyLabels} />}</td>
                      <td>{r.resourceTypes.length === 0 ? "all" : r.resourceTypes.join(", ")}</td>
                      <td>{r.logins.join(", ") || "—"}</td>
                      <td>{r.maxSessionTTLMinutes || "∞"}</td>
                      <td>{r.allowedCIDRs.join(", ") || "any"}</td>
                      <td>{r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "never"}</td>
                      <td>{Object.keys(r.manageLabels ?? {}).length === 0 ? "—" : <LabelChips labels={r.manageLabels} />}</td>
                      <td>{r.allowClipboard === false ? "blocked" : "allowed"}</td>
                      <td>
                        <div className="row-actions">
                          <button className="link" onClick={() => startEdit(r)}>
                            Edit
                          </button>
                          {r.name !== "admin" && (
                            <button className="danger-link" onClick={() => remove(r.name)}>
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </div>
  );
}
