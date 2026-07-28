import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { fetchDashboard, fetchDashboardLayout, saveDashboardLayout, type DashboardData, type DashboardWidgetInstance, type WidgetSize } from "../api";
import { WIDGET_CATALOG, DEFAULT_WIDGETS, newWidgetInstance, widgetMeta, type WidgetType } from "../components/dashboard/widgetCatalog";
import { WidgetRenderer } from "../components/dashboard/WidgetRenderer";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";

const SIZE_CYCLE: Record<WidgetSize, WidgetSize> = { small: "medium", medium: "large", large: "small" };

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [widgets, setWidgets] = useState<DashboardWidgetInstance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    fetchDashboard().then(setData).catch((e) => setError(e.message));
    const interval = setInterval(() => fetchDashboard().then(setData).catch(() => {}), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetchDashboardLayout()
      .then((r) => setWidgets(r.widgets ?? DEFAULT_WIDGETS))
      .catch(() => setWidgets(DEFAULT_WIDGETS));
  }, []);

  function persist(next: DashboardWidgetInstance[]) {
    setWidgets(next);
    saveDashboardLayout(next).catch(() => {});
  }

  function addWidget(type: WidgetType) {
    persist([...(widgets ?? []), newWidgetInstance(type)]);
    setShowPicker(false);
  }

  function removeWidget(id: string) {
    persist((widgets ?? []).filter((w) => w.id !== id));
  }

  function moveWidget(id: string, dir: -1 | 1) {
    const list = widgets ?? [];
    const idx = list.findIndex((w) => w.id === id);
    const swapWith = idx + dir;
    if (idx === -1 || swapWith < 0 || swapWith >= list.length) return;
    const next = [...list];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    persist(next);
  }

  function cycleSize(id: string) {
    persist((widgets ?? []).map((w) => (w.id === id ? { ...w, size: SIZE_CYCLE[w.size] } : w)));
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="page-sub">Live snapshot, computed from the same audit log and session state everything else here uses. Add, remove, reorder, and resize widgets to make it yours.</p>
        </div>
        <button className={editing ? "primary" : "secondary"} style={{ width: "auto", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setEditing((e) => !e)}>
          {editing ? "Done editing" : (
            <>
              <Icon name="pen" size={13} /> Edit dashboard
            </>
          )}
        </button>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {(!data || !widgets) && !error && <Skeleton lines={4} />}

      {editing && (
        <div style={{ marginBottom: 16 }}>
          <button className="secondary" onClick={() => setShowPicker(true)}>+ Add widget</button>
        </div>
      )}

      {data && widgets && (
        <div className="dashboard-grid">
          {widgets.length === 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <EmptyState
                icon="grid"
                message='No widgets on this dashboard yet. Click "Edit dashboard" to add some.'
                action={{ label: "+ Add widget", onClick: () => { setEditing(true); setShowPicker(true); } }}
              />
            </div>
          )}
          {widgets.map((w, i) => {
            const meta = widgetMeta(w.type);
            return (
              <div key={w.id} className={`section-card dashboard-widget dashboard-widget-${w.size}`}>
                {editing && (
                  <div className="dashboard-widget-controls">
                    <button className="btn-sm" title="Move left/up" onClick={() => moveWidget(w.id, -1)} disabled={i === 0}>◀</button>
                    <button className="btn-sm" title="Move right/down" onClick={() => moveWidget(w.id, 1)} disabled={i === widgets.length - 1}>▶</button>
                    <button className="btn-sm" title={`Size: ${w.size} (click to change)`} onClick={() => cycleSize(w.id)}>{w.size[0].toUpperCase()}</button>
                    <button className="btn-sm danger-link" title="Remove widget" onClick={() => removeWidget(w.id)}>✕</button>
                  </div>
                )}
                {meta ? <WidgetRenderer type={w.type as WidgetType} data={data} /> : <div className="empty-state">Unknown widget "{w.type}"</div>}
              </div>
            );
          })}
        </div>
      )}

      {showPicker && (
        <div className="modal-overlay" onClick={() => setShowPicker(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
            <h3>Add a widget</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "50vh", overflowY: "auto" }}>
              {WIDGET_CATALOG.map((meta) => (
                <button
                  key={meta.type}
                  className="diagram-list-item"
                  onClick={() => addWidget(meta.type)}
                  style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, textAlign: "left" }}
                >
                  <span style={{ fontSize: 20 }}>{meta.icon}</span>
                  <span>
                    <strong style={{ display: "block" }}>{meta.label}</strong>
                    <span className="diagram-list-meta">{meta.description}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowPicker(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
