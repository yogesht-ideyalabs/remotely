import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchActiveSessions, terminateSessionApi, type ActiveSession } from "../api";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ${seconds % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function connectPath(s: ActiveSession): string {
  if (s.type === "rdp") return `/rdp/${s.resourceId}`;
  if (s.type === "vnc") return `/vnc/${s.resourceId}`;
  if (s.type === "database") return `/db/${s.resourceId}`;
  return `/terminal/${s.resourceId}?kind=${s.type}`;
}

export default function Sessions() {
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function load() {
      fetchActiveSessions().then(setSessions).catch((e) => setError(e.message));
    }
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, []);

  async function terminate(s: ActiveSession) {
    if (!confirm(`Terminate ${s.username}'s session on ${s.resourceHostname}?`)) return;
    try {
      await terminateSessionApi(s.id);
      setSessions((prev) => prev?.filter((x) => x.id !== s.id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "terminate failed");
    }
  }

  return (
    <div>
      <h2 className="page-title">Active Sessions</h2>
      <p className="page-sub">
        Every currently open session, across SSH/RDP/database, live monitoring + forced termination. Refreshes every
        8s. "Jump in" opens a fresh session to the same resource — it doesn't reattach to this exact live session
        (that would need session persistence, which isn't built).
      </p>
      {error && <div className="error-banner">{error}</div>}
      {sessions && sessions.length === 0 && <div className="empty-state">No active sessions right now.</div>}
      {sessions && sessions.length > 0 && (
        <table className="audit-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Resource</th>
              <th>Type</th>
              <th>Login</th>
              <th>Duration</th>
              <th>Watching</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.username}</td>
                <td>{s.resourceHostname}</td>
                <td>
                  <span className="label-chip">{s.type}</span>
                </td>
                <td>{s.login ?? "—"}</td>
                <td>{formatDuration(s.durationSeconds)}</td>
                <td>{s.watchers > 0 ? `${s.watchers} 👁` : "—"}</td>
                <td>
                  <button className="link" onClick={() => navigate(`/watch/${s.id}`)}>
                    watch
                  </button>
                  <button className="link" onClick={() => navigate(connectPath(s))}>
                    jump in
                  </button>
                  <button className="danger-link" onClick={() => terminate(s)}>
                    terminate
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
