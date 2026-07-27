import { useEffect, useMemo, useState } from "react";
import {
  fetchConnections,
  createConnectionApi,
  updateConnectionApi,
  deleteConnectionApi,
  assignFolderApi,
  fetchUsers,
  fetchOrganizations,
  fetchAllSshKeys,
  type Connection,
  type ConnectionType,
  type AdminUser,
  type Organization,
  type SshKeyMeta,
} from "../api";
import { useOrgFilter } from "../OrgContext";
import { LabelChips } from "../components/LabelChips";
import { FieldLabel } from "../components/FieldLabel";

const emptyForm = {
  id: "",
  hostname: "",
  type: "ssh-direct" as ConnectionType,
  organization: "",
  extraLabelsJson: "{}",
  folder: "",
  host: "",
  port: "22",
  username: "",
  password: "",
  databaseName: "",
  dbEngine: "postgres" as "postgres" | "mysql",
  sshKeyId: "",
  sshJitEnabled: false,
  kubeconfigText: "",
  k8sNamespace: "",
  k8sPodName: "",
  k8sContainerName: "",
};

export default function Connections() {
  const [conns, setConns] = useState<Connection[] | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [sshKeys, setSshKeys] = useState<SshKeyMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [assigningFolder, setAssigningFolder] = useState<string | null>(null);
  const [folderAssignees, setFolderAssignees] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAssignees, setBulkAssignees] = useState<string[]>([]);
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [bulkFolder, setBulkFolder] = useState("");
  const { selected: selectedOrg } = useOrgFilter();

  function load() {
    fetchConnections().then(setConns).catch((e) => setError(e.message));
    fetchUsers().then(setUsers).catch(() => setUsers([]));
    fetchOrganizations()
      .then(setOrgs)
      .catch(() => setOrgs([]));
    fetchAllSshKeys()
      .then(setSshKeys)
      .catch(() => setSshKeys([]));
  }
  useEffect(load, []);

  const orgFiltered = useMemo(() => {
    if (!conns) return null;
    return selectedOrg ? conns.filter((c) => c.labels.client === selectedOrg) : conns;
  }, [conns, selectedOrg]);

  const groups = useMemo(() => {
    if (!orgFiltered) return null;
    const byFolder = new Map<string, Connection[]>();
    for (const c of orgFiltered) {
      const key = c.folder || "Uncategorized";
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key)!.push(c);
    }
    return Array.from(byFolder.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [conns]);

  function startCreate() {
    setForm(emptyForm);
    setEditing("");
  }

  function startEdit(c: Connection) {
    setForm({
      id: c.id,
      hostname: c.hostname,
      type: c.type,
      organization: c.labels.client ?? "",
      extraLabelsJson: JSON.stringify(Object.fromEntries(Object.entries(c.labels).filter(([k]) => k !== "client"))),
      folder: c.folder,
      host: c.host,
      port: String(c.port),
      username: c.username,
      password: "",
      databaseName: c.databaseName,
      dbEngine: c.dbEngine ?? "postgres",
      sshKeyId: c.sshKeyId ?? "",
      sshJitEnabled: Boolean(c.sshJitEnabled),
      kubeconfigText: c.kubeconfig ? decodeURIComponent(escape(atob(c.kubeconfig))) : "",
      k8sNamespace: c.k8sNamespace ?? "",
      k8sPodName: c.k8sPodName ?? "",
      k8sContainerName: c.k8sContainerName ?? "",
    });
    setEditing(c.id);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let extraLabels;
    try {
      extraLabels = JSON.parse(form.extraLabelsJson || "{}");
    } catch {
      setError('extra labels must be valid JSON, e.g. {"region":"us-east-1"}');
      return;
    }
    const labels = { ...extraLabels, ...(form.organization ? { client: form.organization } : {}) };
    const payload = {
      hostname: form.hostname,
      type: form.type,
      labels,
      folder: form.folder,
      host: form.host,
      port: Number(form.port) || 0,
      // Kubernetes has no per-connection "login" the way ssh/rdp/database
      // do (there's no login negotiation in a pod exec) — reuse the same
      // logins-allowlist RBAC mechanism everywhere else with one fixed
      // conventional value, so "can this role use kubernetes connections
      // at all" is still gated the normal way instead of inventing a
      // separate concept just for this type.
      username: form.type === "kubernetes" ? "exec" : form.username,
      ...(form.password ? { password: form.password } : {}),
      databaseName: form.databaseName,
      dbEngine: form.type === "database" ? form.dbEngine : undefined,
      sshKeyId: form.type === "ssh-direct" ? form.sshKeyId || undefined : undefined,
      sshJitEnabled: form.type === "ssh-direct" ? form.sshJitEnabled : false,
      ...(form.type === "kubernetes"
        ? {
            kubeconfig: form.kubeconfigText ? btoa(unescape(encodeURIComponent(form.kubeconfigText))) : undefined,
            k8sNamespace: form.k8sNamespace,
            k8sPodName: form.k8sPodName,
            k8sContainerName: form.k8sContainerName || undefined,
          }
        : {}),
    };
    try {
      if (editing === "") {
        await createConnectionApi(payload);
      } else if (editing) {
        await updateConnectionApi(editing, payload);
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    }
  }

  async function remove(id: string) {
    if (!confirm(`Delete connection "${id}"?`)) return;
    try {
      await deleteConnectionApi(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  async function toggleAssignedUser(c: Connection, username: string) {
    const assignedUsers = c.assignedUsers.includes(username)
      ? c.assignedUsers.filter((u) => u !== username)
      : [...c.assignedUsers, username];
    try {
      await updateConnectionApi(c.id, { assignedUsers });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "assign failed");
    }
  }

  function startAssignFolder(folder: string) {
    setAssigningFolder(folder);
    setFolderAssignees([]);
  }

  async function saveAssignFolder() {
    if (!assigningFolder) return;
    try {
      await assignFolderApi(assigningFolder, folderAssignees);
      setAssigningFolder(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "assign failed");
    }
  }

  function toggleSelected(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} selected connection(s)?`)) return;
    setError(null);
    try {
      await Promise.all(Array.from(selected).map((id) => deleteConnectionApi(id)));
      setSelected(new Set());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "bulk delete failed");
    }
  }

  async function bulkAssign() {
    if (!conns) return;
    setError(null);
    try {
      await Promise.all(
        Array.from(selected).map((id) => {
          const c = conns.find((x) => x.id === id)!;
          const assignedUsers = Array.from(new Set([...c.assignedUsers, ...bulkAssignees]));
          return updateConnectionApi(id, { assignedUsers });
        })
      );
      setBulkAssigning(false);
      setBulkAssignees([]);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "bulk assign failed");
    }
  }

  async function bulkMoveFolder() {
    if (!bulkFolder) return;
    setError(null);
    try {
      await Promise.all(Array.from(selected).map((id) => updateConnectionApi(id, { folder: bulkFolder })));
      setBulkFolder("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "bulk move failed");
    }
  }

  const defaultPorts: Record<ConnectionType, string> = { "ssh-direct": "22", rdp: "3389", database: "5432", kubernetes: "" };

  return (
    <div>
      <h2 className="page-title">Connections</h2>
      <p className="page-sub">
        Add a connection with a host and credentials — it's connectable immediately, no agent to deploy. Grouped by
        folder; assign a whole folder or a single connection directly to specific users, independent of roles.
        (SSH-agent resources, the reverse-tunnel kind, register themselves and don't show up here.)
      </p>
      {error && <div className="error-banner">{error}</div>}

      {editing !== null && (
        <form className="section-card" onSubmit={save}>
          <h3>{editing === "" ? "New connection" : `Edit ${editing}`}</h3>
          <div className="form-row">
            <div>
              <FieldLabel label="Display name">
                What shows up in the Resources list and in every session/audit record. Pick something recognizable —
                it doesn't have to match the real hostname.
              </FieldLabel>
              <input
                placeholder="display name / hostname"
                value={form.hostname}
                onChange={(e) => setForm({ ...form, hostname: e.target.value })}
              />
            </div>
            <div>
              <FieldLabel label="Type">
                What protocol Remotely speaks to reach it. Determines which other fields on this form apply, and
                which client (terminal, RDP console, DB query panel, pod exec) opens on connect.
              </FieldLabel>
              <select
                value={form.type}
                onChange={(e) => {
                  const type = e.target.value as ConnectionType;
                  setForm({ ...form, type, port: defaultPorts[type] });
                }}
              >
                <option value="ssh-direct">SSH (direct)</option>
                <option value="rdp">RDP</option>
                <option value="database">Database (PostgreSQL / MySQL)</option>
                <option value="kubernetes">Kubernetes (pod exec)</option>
              </select>
            </div>
            <div>
              <FieldLabel label="Organization">
                Which tenant this connection belongs to — find it on the <b>Organizations</b> page. Delegated admins
                only ever see connections tagged with their own organization; leave unset for a connection that
                isn't tenant-scoped.
              </FieldLabel>
              <select value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })}>
                <option value="">— no organization —</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel label="Folder">
                Groups this connection with others on the Resources/Connections list, e.g. <b>Servers</b>,{" "}
                <b>Databases</b>. Purely organizational — has no effect on access.
              </FieldLabel>
              <input placeholder="folder, e.g. Servers" value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} />
            </div>
          </div>
          {form.type !== "kubernetes" && (
            <div className="form-row">
              <div>
                <FieldLabel label="Host">
                  The real hostname or IP address Remotely dials. For a Docker Compose demo target this is usually a
                  service name (e.g. <b>ssh-target</b>); for real infrastructure, its actual DNS name or IP.
                </FieldLabel>
                <input placeholder="host" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
              </div>
              <div>
                <FieldLabel label="Port">
                  Defaults to the standard port for the selected type (22 for SSH, 3389 for RDP, 5432 for Postgres) —
                  only change it if the target listens somewhere non-standard.
                </FieldLabel>
                <input placeholder="port" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
              </div>
              <div>
                <FieldLabel label="Username">
                  The OS or database login username on the target itself — not a Remotely account. This is who the
                  session authenticates as once connected.
                </FieldLabel>
                <input placeholder="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
              <div>
                <FieldLabel label="Password">
                  The credential for the username above. For ssh-direct, only used if the auth method below is set
                  to Password — ignored (and disabled) for a stored key or JIT ephemeral key.
                </FieldLabel>
                <input
                  placeholder={
                    form.type === "ssh-direct" && (form.sshKeyId || form.sshJitEnabled)
                      ? "password (unused for this auth method)"
                      : editing === ""
                      ? "password"
                      : "password (leave blank to keep)"
                  }
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  disabled={form.type === "ssh-direct" && (Boolean(form.sshKeyId) || form.sshJitEnabled)}
                />
              </div>
              {form.type === "database" && (
                <>
                  <div>
                    <FieldLabel label="Engine">Which database server this is — the query console speaks the right wire protocol for whichever you pick.</FieldLabel>
                    <select value={form.dbEngine} onChange={(e) => setForm({ ...form, dbEngine: e.target.value as "postgres" | "mysql" })}>
                      <option value="postgres">PostgreSQL</option>
                      <option value="mysql">MySQL</option>
                    </select>
                  </div>
                  <div>
                    <FieldLabel label="Database name">
                      The specific database to connect to on that host — not the server, the individual database
                      within it (what you'd pass to <code>{form.dbEngine === "mysql" ? "mysql -D" : "psql -d"}</code>).
                    </FieldLabel>
                    <input placeholder="database name" value={form.databaseName} onChange={(e) => setForm({ ...form, databaseName: e.target.value })} />
                  </div>
                </>
              )}
            </div>
          )}
          {form.type === "kubernetes" && (
            <>
              <div className="form-row">
                <div style={{ flex: "1 1 100%" }} className="hint">
                  A role needs "exec" in its allowed logins to use any kubernetes connection — there's no per-pod
                  login the way ssh/database have, so this is the one fixed value that gates access.
                </div>
              </div>
              <div className="form-row">
                <div>
                  <FieldLabel label="Namespace">
                    The Kubernetes namespace the pod lives in — find it with <code>kubectl get pods -A</code> under
                    the <b>NAMESPACE</b> column.
                  </FieldLabel>
                  <input placeholder="namespace" value={form.k8sNamespace} onChange={(e) => setForm({ ...form, k8sNamespace: e.target.value })} />
                </div>
                <div>
                  <FieldLabel label="Pod name">
                    The exact pod to exec into — from <code>kubectl get pods -n &lt;namespace&gt;</code>. This
                    connection execs into this one pod specifically, not a general kubectl-proxy.
                  </FieldLabel>
                  <input placeholder="pod name" value={form.k8sPodName} onChange={(e) => setForm({ ...form, k8sPodName: e.target.value })} />
                </div>
                <div>
                  <FieldLabel label="Container name">
                    Optional — only needed if the pod has more than one container. From{" "}
                    <code>kubectl get pod &lt;pod&gt; -o jsonpath='{"{"}.spec.containers[*].name{"}"}'</code>.
                  </FieldLabel>
                  <input
                    placeholder="container name (optional — defaults to the pod's first container)"
                    style={{ minWidth: 320 }}
                    value={form.k8sContainerName}
                    onChange={(e) => setForm({ ...form, k8sContainerName: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div className="hint">
                  Kubeconfig (full YAML, same content <code>kubectl config view --raw</code> produces). One
                  connection execs into exactly this one pod/container, not a general kubectl-proxy. Note: like the
                  password field above, this round-trips to any admin who can view connections — same POC-level
                  tradeoff, not hidden or specially protected.
                </div>
                <textarea
                  rows={8}
                  style={{ fontFamily: "SF Mono, ui-monospace, monospace", fontSize: 11 }}
                  placeholder={editing !== "" ? "leave blank to keep the existing kubeconfig" : "apiVersion: v1\nclusters:\n..."}
                  value={form.kubeconfigText}
                  onChange={(e) => setForm({ ...form, kubeconfigText: e.target.value })}
                />
              </div>
            </>
          )}
          {form.type === "ssh-direct" && (
            <div className="form-row">
              <div style={{ flex: 1, minWidth: 260 }}>
                <div className="hint">
                  Authentication method — JIT takes priority over a stored key, which takes priority over password.
                  Requires the target's sshd to be configured for it (see control-plane/scripts/setup-ssh-jit.sh).
                </div>
                <select
                  value={form.sshJitEnabled ? "jit" : form.sshKeyId ? "key" : "password"}
                  onChange={(e) => {
                    const mode = e.target.value;
                    setForm({
                      ...form,
                      sshJitEnabled: mode === "jit",
                      sshKeyId: mode === "key" ? form.sshKeyId : "",
                    });
                  }}
                >
                  <option value="password">Password</option>
                  <option value="key">Stored SSH key</option>
                  <option value="jit">Just-in-time ephemeral key (short-lived, no stored credential)</option>
                </select>
                {!form.sshJitEnabled && (
                  <select
                    value={form.sshKeyId}
                    onChange={(e) => setForm({ ...form, sshKeyId: e.target.value, sshJitEnabled: false })}
                    style={{ marginTop: 8 }}
                    disabled={form.sshJitEnabled}
                  >
                    <option value="">— use password —</option>
                    {sshKeys.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name} ({k.ownerUsername})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}
          <div className="form-row">
            <div style={{ flex: 1, minWidth: 260 }}>
              <FieldLabel label="Extra labels (JSON)">
                Beyond organization, for finer RBAC matching — a role's allow/deny rules can key off any of these,
                e.g. <code>{"{"}"region":"us-east-1","env":"prod"{"}"}</code>. Pick keys that match what your roles
                already filter on (check the Roles page's Allow/Deny columns).
              </FieldLabel>
              <input value={form.extraLabelsJson} onChange={(e) => setForm({ ...form, extraLabelsJson: e.target.value })} />
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
          + New connection
        </button>
      )}

      {selected.size > 0 && (
        <div className="section-card" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <b style={{ fontSize: 12 }}>{selected.size} selected</b>
          <button className="secondary" onClick={() => setBulkAssigning((b) => !b)}>
            Assign selected to users
          </button>
          <input
            placeholder="move to folder..."
            value={bulkFolder}
            onChange={(e) => setBulkFolder(e.target.value)}
            style={{ width: 180 }}
          />
          <button className="secondary" disabled={!bulkFolder} onClick={bulkMoveFolder}>
            Move
          </button>
          <button className="danger-link" onClick={bulkDelete}>
            Delete selected
          </button>
          <button className="link" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
          {bulkAssigning && (
            <div style={{ width: "100%", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--panel-border)" }}>
              <div className="tag-input-list">
                {users.map((u) => (
                  <button
                    type="button"
                    key={u.username}
                    className="tag-chip"
                    style={{ border: bulkAssignees.includes(u.username) ? "1px solid var(--accent)" : "1px solid transparent" }}
                    onClick={() =>
                      setBulkAssignees((f) => (f.includes(u.username) ? f.filter((x) => x !== u.username) : [...f, u.username]))
                    }
                  >
                    {bulkAssignees.includes(u.username) ? "✓ " : ""}
                    {u.username}
                  </button>
                ))}
              </div>
              <button className="primary" style={{ width: "auto", padding: "6px 16px", marginTop: 8 }} onClick={bulkAssign}>
                Apply
              </button>
            </div>
          )}
        </div>
      )}

      {groups &&
        groups.map(([folder, items]) => (
          <div key={folder} className="section-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>
                {folder} <span style={{ opacity: 0.6 }}>({items.length})</span>
              </h3>
              {folder !== "Uncategorized" && (
                <button className="secondary" onClick={() => startAssignFolder(folder)}>
                  Assign folder to users
                </button>
              )}
            </div>

            {assigningFolder === folder && (
              <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--panel-border)" }}>
                <div className="hint" style={{ marginBottom: 8 }}>
                  Grant every connection in "{folder}" directly to (adds to, doesn't replace, existing grants):
                </div>
                <div className="tag-input-list">
                  {users.map((u) => (
                    <button
                      type="button"
                      key={u.username}
                      className="tag-chip"
                      style={{ border: folderAssignees.includes(u.username) ? "1px solid var(--accent)" : "1px solid transparent" }}
                      onClick={() =>
                        setFolderAssignees((f) => (f.includes(u.username) ? f.filter((x) => x !== u.username) : [...f, u.username]))
                      }
                    >
                      {folderAssignees.includes(u.username) ? "✓ " : ""}
                      {u.username}
                    </button>
                  ))}
                </div>
                <div className="form-row" style={{ marginTop: 10 }}>
                  <button className="primary" style={{ width: "auto", padding: "6px 16px" }} onClick={saveAssignFolder}>
                    Apply
                  </button>
                  <button className="secondary" onClick={() => setAssigningFolder(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="admin-table-wrap">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Hostname</th>
                    <th>Type</th>
                    <th>Host:Port</th>
                    <th>Labels</th>
                    <th>Assigned users (direct grant)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelected(c.id)} style={{ width: "auto" }} />
                      </td>
                      <td>{c.hostname}</td>
                      <td>
                        <span className="label-chip">{c.type}</span>
                      </td>
                      <td>
                        {c.host}:{c.port}
                        {c.sshJitEnabled && (
                          <div className="hint" style={{ margin: 0 }}>
                            ⚡ JIT ephemeral key
                          </div>
                        )}
                        {!c.sshJitEnabled && c.sshKeyId && (
                          <div className="hint" style={{ margin: 0 }}>
                            🔑 {sshKeys.find((k) => k.id === c.sshKeyId)?.name ?? "key"}
                          </div>
                        )}
                      </td>
                      <td>
                        <LabelChips labels={c.labels} />
                      </td>
                      <td>
                        <div className="pill-list">
                          {users.map((u) => (
                            <button
                              key={u.username}
                              className="tag-chip"
                              style={{ opacity: c.assignedUsers.includes(u.username) ? 1 : 0.35, cursor: "pointer" }}
                              onClick={() => toggleAssignedUser(c, u.username)}
                            >
                              {u.username}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="link" onClick={() => startEdit(c)}>
                            Edit
                          </button>
                          <button className="danger-link" onClick={() => remove(c.id)}>
                            Delete
                          </button>
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
