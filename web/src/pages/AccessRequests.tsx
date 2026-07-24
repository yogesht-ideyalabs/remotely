import { useEffect, useMemo, useState } from "react";
import {
  createAccessRequestApi,
  fetchMyAccessRequests,
  fetchAdminAccessRequests,
  approveAccessRequestApi,
  denyAccessRequestApi,
  revokeAccessRequestApi,
  giveUpAccessRequestApi,
  getSession,
  type AccessRequestItem,
  type AccessRequestStatus,
} from "../api";

const STATUS_COLORS: Record<string, string> = {
  pending: "var(--accent)",
  approved: "var(--ok)",
  denied: "var(--danger)",
  revoked: "var(--danger)",
  expired: "var(--text-dim)",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      style={{
        color: STATUS_COLORS[status] ?? "var(--text-dim)",
        border: `1px solid ${STATUS_COLORS[status] ?? "var(--panel-border)"}`,
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.5,
      }}
    >
      {status}
    </span>
  );
}

export default function AccessRequests() {
  const session = getSession();
  const anyAdmin = Boolean(session?.isAdmin || session?.isDelegatedAdmin);
  const [mine, setMine] = useState<AccessRequestItem[] | null>(null);
  const [queue, setQueue] = useState<AccessRequestItem[] | null>(null);
  const [history, setHistory] = useState<AccessRequestItem[] | null>(null);
  const [historyStatus, setHistoryStatus] = useState<AccessRequestStatus | "">("");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ resourceId: "", login: "demo", reason: "", breakGlass: false });
  const [submitting, setSubmitting] = useState(false);

  function loadMine() {
    fetchMyAccessRequests().then(setMine).catch((e) => setError(e.message));
  }
  function loadQueue() {
    if (!anyAdmin) return;
    fetchAdminAccessRequests("pending").then(setQueue).catch(() => {});
  }
  // Every decided request (approved/denied/revoked/expired) — who decided
  // it and when — since the queue above only ever shows what's still
  // pending and nothing previously surfaced past decisions at all.
  function loadHistory() {
    if (!anyAdmin) return;
    fetchAdminAccessRequests()
      .then((all) => setHistory(all.filter((r) => r.status !== "pending")))
      .catch(() => {});
  }
  useEffect(() => {
    loadMine();
    loadQueue();
    loadHistory();
    const interval = setInterval(() => {
      loadMine();
      loadQueue();
      loadHistory();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await createAccessRequestApi(form.resourceId, form.login, form.reason, form.breakGlass);
      setForm({ resourceId: "", login: "demo", reason: "", breakGlass: false });
      if (created.status === "approved") {
        alert(`Break-glass access granted immediately — expires ${new Date(created.expiresAt!).toLocaleTimeString()}.`);
      }
      loadMine();
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function approve(r: AccessRequestItem) {
    const ttl = prompt("Grant access for how many minutes?", "60");
    if (!ttl) return;
    try {
      await approveAccessRequestApi(r.id, Number(ttl));
      loadQueue();
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "approve failed");
    }
  }

  async function deny(r: AccessRequestItem) {
    const reason = prompt("Reason for denying?", "");
    if (reason === null) return;
    try {
      await denyAccessRequestApi(r.id, reason);
      loadQueue();
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "deny failed");
    }
  }

  async function giveUp(r: AccessRequestItem) {
    if (!confirm(`Give up your access to ${r.resourceId}?`)) return;
    try {
      await giveUpAccessRequestApi(r.id);
      loadMine();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
    }
  }

  async function adminRevoke(r: AccessRequestItem) {
    if (!confirm(`Revoke ${r.requestedBy}'s access to ${r.resourceId}?`)) return;
    try {
      await revokeAccessRequestApi(r.id);
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "revoke failed");
    }
  }

  const filteredHistory = useMemo(() => {
    if (!history) return null;
    return historyStatus ? history.filter((r) => r.status === historyStatus) : history;
  }, [history, historyStatus]);

  return (
    <div>
      <h2 className="page-title">Access Requests</h2>
      <p className="page-sub">
        Don't have access to something you need? Request it here instead of waiting for a role change — an admin
        grants it for a limited time, or (if your role allows) break-glass grants it to yourself immediately for
        genuine emergencies, fully audited either way.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <form className="section-card" onSubmit={submit}>
        <h3>Request access</h3>
        <div className="form-row">
          <input
            placeholder="resource id, e.g. client-a-bastion-01"
            value={form.resourceId}
            onChange={(e) => setForm({ ...form, resourceId: e.target.value })}
          />
          <input placeholder="login, e.g. demo" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
        </div>
        <div className="form-row">
          <input
            placeholder="reason — why do you need this?"
            style={{ flex: 1, minWidth: 260 }}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
        </div>
        <div className="form-row">
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={form.breakGlass}
              onChange={(e) => setForm({ ...form, breakGlass: e.target.checked })}
              style={{ width: "auto", margin: 0 }}
            />
            Break-glass (self-approve immediately — only works if one of your roles is break-glass eligible)
          </label>
        </div>
        <button className="primary" style={{ width: "auto", padding: "8px 20px" }} disabled={submitting || !form.resourceId || !form.reason}>
          Submit request
        </button>
      </form>

      {anyAdmin && (
        <div className="section-card">
          <h3>Approval queue {queue && queue.length > 0 ? `(${queue.length})` : ""}</h3>
          {queue && queue.length === 0 && <div className="empty-state">Nothing pending.</div>}
          {queue && queue.length > 0 && (
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Requested by</th>
                  <th>Resource</th>
                  <th>Login</th>
                  <th>Reason</th>
                  <th>Requested</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {queue.map((r) => (
                  <tr key={r.id}>
                    <td>{r.requestedBy}</td>
                    <td>{r.resourceId}</td>
                    <td>{r.login}</td>
                    <td>{r.reason}</td>
                    <td>{new Date(r.createdAt).toLocaleString()}</td>
                    <td>
                      <button className="link" onClick={() => approve(r)}>
                        approve
                      </button>
                      <button className="danger-link" onClick={() => deny(r)}>
                        deny
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {anyAdmin && (
        <div className="section-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>Approval history</h3>
            <select value={historyStatus} onChange={(e) => setHistoryStatus(e.target.value as AccessRequestStatus | "")} style={{ width: "auto" }}>
              <option value="">All decided requests</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
              <option value="revoked">Revoked</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          {filteredHistory && filteredHistory.length === 0 && <div className="empty-state">Nothing decided yet.</div>}
          {filteredHistory && filteredHistory.length > 0 && (
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Requested by</th>
                  <th>Resource</th>
                  <th>Login</th>
                  <th>Status</th>
                  <th>Reason</th>
                  <th>Decided by</th>
                  <th>Decided</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((r) => (
                  <tr key={r.id}>
                    <td>{r.requestedBy}</td>
                    <td>{r.resourceId}</td>
                    <td>{r.login}</td>
                    <td>
                      <StatusBadge status={r.status} />
                      {r.breakGlass && (
                        <span className="hint" style={{ margin: 0, marginLeft: 6 }}>
                          ⚡ break-glass
                        </span>
                      )}
                    </td>
                    <td>{r.status === "denied" && r.denyReason ? r.denyReason : r.reason}</td>
                    <td>{r.decidedBy ?? "—"}</td>
                    <td>{r.decidedAt ? new Date(r.decidedAt).toLocaleString() : "—"}</td>
                    <td>
                      {r.status === "approved" && (!r.expiresAt || r.expiresAt > Date.now()) && (
                        <button className="danger-link" onClick={() => adminRevoke(r)}>
                          revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="section-card">
        <h3>My requests</h3>
        {mine && mine.length === 0 && <div className="empty-state">You haven't requested access to anything.</div>}
        {mine && mine.length > 0 && (
          <table className="audit-table">
            <thead>
              <tr>
                <th>Resource</th>
                <th>Login</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {mine.map((r) => (
                <tr key={r.id}>
                  <td>{r.resourceId}</td>
                  <td>{r.login}</td>
                  <td>
                    <StatusBadge status={r.status} />
                    {r.breakGlass && (
                      <span className="hint" style={{ margin: 0, marginLeft: 6 }}>
                        ⚡ break-glass
                      </span>
                    )}
                  </td>
                  <td>{r.reason}</td>
                  <td>{r.expiresAt ? new Date(r.expiresAt).toLocaleString() : "—"}</td>
                  <td>
                    {r.status === "approved" && (
                      <button className="danger-link" onClick={() => giveUp(r)}>
                        give up access
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
