import { useEffect, useRef, useState } from "react";
import { fetchNotifications, type NotificationEvent } from "./api";
import { useDismiss } from "./useDismiss";

export default function NotificationBell() {
  const [items, setItems] = useState<NotificationEvent[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useDismiss(ref, open, () => setOpen(false));

  useEffect(() => {
    let mounted = true;
    function load() {
      fetchNotifications()
        .then((data) => mounted && setItems(data))
        .catch(() => {});
    }
    load();
    const interval = setInterval(load, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} title="Notifications">
        🔔
        {items.length > 0 && <span className="notif-badge">{items.length > 9 ? "9+" : items.length}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">Notifications</div>
          {items.length === 0 && <div className="hint" style={{ padding: 12 }}>Nothing to see here.</div>}
          {items.map((n) => (
            <div className="notif-item" key={n.id}>
              <span className={`event-badge ${n.eventType}`}>{n.eventType}</span>
              <div style={{ fontSize: 12, margin: "4px 0" }}>{n.details}</div>
              <div className="hint">
                {n.username} · {new Date(n.ts).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
