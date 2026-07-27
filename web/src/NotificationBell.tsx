import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchNotifications, clearNotifications, type NotificationEvent } from "./api";
import { useDismiss } from "./useDismiss";

export default function NotificationBell() {
  const [items, setItems] = useState<NotificationEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useDismiss(ref, open, () => setOpen(false));

  function load() {
    fetchNotifications()
      .then(setItems)
      .catch(() => {});
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  async function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    setClearing(true);
    try {
      await clearNotifications();
      setItems([]);
    } finally {
      setClearing(false);
    }
  }

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} title="Notifications">
        🔔
        {items.length > 0 && <span className="notif-badge">{items.length > 9 ? "9+" : items.length}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">
            <span>Notifications</span>
            {items.length > 0 && (
              <button className="link" onClick={handleClear} disabled={clearing}>
                {clearing ? "Clearing..." : "Clear"}
              </button>
            )}
          </div>
          {items.length === 0 && (
            <div className="hint" style={{ padding: 12 }}>
              Nothing new.
            </div>
          )}
          {items.map((n) => (
            <div className="notif-item" key={n.id}>
              <span className={`event-badge ${n.eventType}`}>{n.eventType}</span>
              <div style={{ fontSize: 12, margin: "4px 0" }}>{n.details}</div>
              <div className="hint">
                {n.username} · {new Date(n.ts).toLocaleString()}
              </div>
            </div>
          ))}
          <Link to="/notifications" className="notif-panel-footer" onClick={() => setOpen(false)}>
            View all notifications (last 30 days) →
          </Link>
        </div>
      )}
    </div>
  );
}
