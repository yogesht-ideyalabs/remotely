import { useEffect, useState } from "react";
import { fetchNotificationHistory, clearNotifications, type NotificationEvent } from "../api";

export default function Notifications() {
  const [events, setEvents] = useState<NotificationEvent[] | null>(null);
  const [clearedAt, setClearedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  function load() {
    fetchNotificationHistory(30)
      .then((h) => {
        setEvents(h.events);
        setClearedAt(h.clearedAt);
      })
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function handleClearAll() {
    if (!confirm("Clear notifications? This resets the bell's badge/dropdown — this history page keeps showing the full 30-day record either way.")) return;
    setClearing(true);
    try {
      const { clearedAt: newClearedAt } = await clearNotifications();
      setClearedAt(newClearedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "clear failed");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div>
      <h2 className="page-title">Notifications</h2>
      <p className="page-sub">
        Every notification-worthy event from the last 30 days — access denials, session errors/expirations, new
        connections, new users. "Clear" resets the bell's quick dropdown; this page always shows the full history
        regardless, the same way the audit log itself is never edited or deleted.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="form-row" style={{ justifyContent: "flex-end" }}>
        <button className="secondary" onClick={handleClearAll} disabled={clearing || !events || events.length === 0}>
          {clearing ? "Clearing..." : "Clear (reset bell)"}
        </button>
      </div>

      {events && events.length === 0 && <div className="empty-state">No notifications in the last 30 days.</div>}
      {events && events.length > 0 && (
        <table className="audit-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Event</th>
              <th>Resource</th>
              <th>Details</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events.map((n) => (
              <tr key={n.id} style={n.ts <= clearedAt ? { opacity: 0.55 } : undefined}>
                <td>{new Date(n.ts).toLocaleString()}</td>
                <td>{n.username}</td>
                <td>
                  <span className={`event-badge ${n.eventType}`}>{n.eventType}</span>
                </td>
                <td>{n.resourceId ?? "—"}</td>
                <td>{n.details}</td>
                <td>{n.ts <= clearedAt ? <span className="hint" style={{ margin: 0 }}>cleared</span> : <span className="label-chip">new</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
