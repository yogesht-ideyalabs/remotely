import { useEffect, useState } from "react";
import { fetchModeratedSessions, approveModeratedSessionApi, type PendingModeratedSession } from "../api";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";

function secondsAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ${s % 60}s ago`;
}

export default function ModeratedSessions() {
  const [sessions, setSessions] = useState<PendingModeratedSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  function load() {
    fetchModeratedSessions()
      .then(setSessions)
      .catch((e) => setError(e.message));
  }
  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  async function approve(sessionId: string) {
    setApproving(sessionId);
    setError(null);
    try {
      await approveModeratedSessionApi(sessionId);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "approve failed");
    } finally {
      setApproving(null);
    }
  }

  return (
    <div>
      <h2 className="page-title">Moderated Sessions</h2>
      <p className="page-sub">
        Sessions from roles with "Require session moderation" enabled wait here until a moderator approves them —
        the requesting user's terminal stays blank until then. Only visible to full admins and roles with "Can
        moderate" enabled. Refreshes automatically every 5 seconds.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {sessions === null && <Skeleton lines={3} />}
      {sessions && sessions.length === 0 && (
        <EmptyState icon="activity" message="No sessions waiting for moderation right now." />
      )}
      {sessions && sessions.length > 0 && (
        <div className="admin-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Resource</th>
                <th>Waiting since</th>
                <th>Moderators</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.sessionId}>
                  <td>{s.username}</td>
                  <td>{s.resourceHostname}</td>
                  <td>{secondsAgo(s.requestedAt)}</td>
                  <td>
                    {s.currentModerators.length} / {s.requiredModerators}
                    {s.currentModerators.length > 0 && (
                      <span className="hint" style={{ marginLeft: 8 }}>
                        ({s.currentModerators.join(", ")})
                      </span>
                    )}
                  </td>
                  <td>
                    <button className="primary" style={{ width: "auto", padding: "6px 16px" }} disabled={approving === s.sessionId} onClick={() => approve(s.sessionId)}>
                      {approving === s.sessionId ? "Approving..." : "Approve"}
                    </button>
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
