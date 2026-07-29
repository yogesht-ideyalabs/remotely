import { useEffect, useState } from "react";
import {
  fetchBots,
  createBotApi,
  deleteBotApi,
  createBotJoinTokenApi,
  logoutBotEverywhereApi,
  fetchRoles,
  type BotItem,
  type Role,
  type JoinTokenItem,
} from "../api";
import { FieldLabel } from "../components/FieldLabel";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";

export default function Bots() {
  const [bots, setBots] = useState<BotItem[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ id: "", roles: [] as string[] });
  const [justCreatedToken, setJustCreatedToken] = useState<{ botId: string; token: JoinTokenItem } | null>(null);

  function load() {
    fetchBots().then(setBots).catch((e) => setError(e.message));
    fetchRoles()
      .then(setRoles)
      .catch(() => setRoles([]));
  }
  useEffect(load, []);

  function toggleRole(name: string) {
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(name) ? f.roles.filter((r) => r !== name) : [...f.roles, name],
    }));
  }

  async function createBot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createBotApi(form.id, form.roles);
      setForm({ id: "", roles: [] });
      setCreating(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    }
  }

  async function removeBot(id: string) {
    if (!confirm(`Delete bot "${id}"? Any join tokens issued for it stop working immediately.`)) return;
    try {
      await deleteBotApi(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  async function generateJoinToken(id: string) {
    setError(null);
    try {
      const token = await createBotJoinTokenApi(id, 1, 60);
      setJustCreatedToken({ botId: id, token });
    } catch (err) {
      setError(err instanceof Error ? err.message : "join token creation failed");
    }
  }

  async function logoutEverywhere(id: string) {
    if (!confirm(`Revoke every token bot "${id}" currently holds? A running job using it will get a 401 on its next request.`)) return;
    setError(null);
    try {
      await logoutBotEverywhereApi(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "logout failed");
    }
  }

  return (
    <div>
      <h2 className="page-title">Bots</h2>
      <p className="page-sub">
        Machine identity for CI pipelines and automation — a bot holds real role assignments (the exact same RBAC
        engine humans use) but authenticates with a short-lived (15-minute), rotatable token instead of a standing
        credential. Bootstrap a bot with a single/limited-use join token, the same mechanism agents already use to
        register.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {justCreatedToken && (
        <div className="section-card" style={{ background: "var(--bg)" }}>
          <div className="hint" style={{ marginTop: 0 }}>
            New join token for <b>{justCreatedToken.botId}</b> (shown once — expires in 60 minutes, single use):
          </div>
          <code style={{ fontSize: 13, wordBreak: "break-all" }}>{justCreatedToken.token.token}</code>
          <p className="hint">
            Exchange it for a real session token: <code>POST /api/bots/join {"{"}"token": "..."{"}"}</code> — the
            response includes a 15-minute token and a <code>POST /api/bots/refresh</code> endpoint to renew it
            before it expires, without presenting this join token again.
          </p>
          <div>
            <button className="link" onClick={() => setJustCreatedToken(null)}>
              dismiss
            </button>
          </div>
        </div>
      )}

      {creating && (
        <form className="section-card" onSubmit={createBot}>
          <h3>New bot</h3>
          <div className="form-row">
            <div>
              <FieldLabel label="Bot ID">
                A stable, unique identifier — e.g. <code>ci-deploy</code> or <code>nightly-backup-job</code>. Shows
                up in the audit log as <code>bot:&lt;id&gt;</code>, distinguishable from human usernames at a
                glance.
              </FieldLabel>
              <input placeholder="ci-deploy" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
            </div>
          </div>
          <FieldLabel label="Roles">
            Same roles humans use — a bot scoped to a database-only, single-resource role can't reach anything
            beyond what that role allows, identical enforcement to a person holding it.
          </FieldLabel>
          <div className="tag-input-list">
            {roles.length === 0 && <div className="hint">No role catalog visible to you.</div>}
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
          + New bot
        </button>
      )}

      {!bots && <Skeleton lines={3} />}
      {bots && bots.length === 0 && (
        <EmptyState
          icon="inbox"
          message="No bots yet — create one to give a CI pipeline or automation script real, RBAC-scoped access without a standing credential."
        />
      )}

      {bots && bots.length > 0 && (
        <div className="admin-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Bot ID</th>
                <th>Roles</th>
                <th>Last joined</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bots.map((b) => (
                <tr key={b.id}>
                  <td>
                    <code>{b.id}</code>
                  </td>
                  <td>
                    <div className="pill-list">
                      {b.roles.length === 0 && <span className="hint">no roles</span>}
                      {b.roles.map((r) => (
                        <span key={r} className="tag-chip">
                          {r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{b.lastJoinedAt ? new Date(b.lastJoinedAt).toLocaleString() : <span className="hint">never</span>}</td>
                  <td>{new Date(b.createdAt).toLocaleDateString()}</td>
                  <td>
                    <div className="row-actions">
                      <button className="link" onClick={() => generateJoinToken(b.id)}>
                        Generate join token
                      </button>
                      <button className="link" onClick={() => logoutEverywhere(b.id)}>
                        Log out everywhere
                      </button>
                      <button className="danger-link" onClick={() => removeBot(b.id)}>
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
