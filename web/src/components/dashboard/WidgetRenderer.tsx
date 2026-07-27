/**
 * Renders one dashboard widget's actual content — all data comes from the
 * single existing /api/admin/dashboard aggregation (extended with
 * agentsList/monitorsList/recentActivity for this pass) rather than a
 * separate endpoint per widget type, since that data was already computed
 * server-side with the correct tenant/label scoping applied.
 *
 * Author: Yogesh Tiwari
 */

import type { DashboardData } from "../../api";
import type { WidgetType } from "./widgetCatalog";
import { StackedBarChart, BarChart, Legend } from "../../Charts";

const EVENT_COLORS: Record<string, string> = {
  login: "var(--ok)",
  login_failed: "var(--danger)",
  session_start: "var(--accent)",
  access_denied: "#e0a325",
};

function KpiCard({ label, value, accent, danger }: { label: string; value: number; accent?: boolean; danger?: boolean }) {
  return (
    <div className="kpi-card">
      <div className="kpi-value" style={{ color: danger ? "var(--danger)" : accent ? "var(--accent)" : "var(--text)" }}>
        {value}
      </div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

export function WidgetRenderer({ type, data }: { type: WidgetType; data: DashboardData }) {
  switch (type) {
    case "kpi-resources":
      return <KpiCard label="Resources" value={data.kpis.totalResources} />;
    case "kpi-sessions":
      return <KpiCard label="Active sessions" value={data.kpis.activeSessions} accent />;
    case "kpi-users":
      return <KpiCard label="Users" value={data.kpis.totalUsers} />;
    case "kpi-agents":
      return <KpiCard label="Agents online" value={data.kpis.agentsOnline} />;
    case "kpi-failed-logins":
      return <KpiCard label="Failed logins (24h)" value={data.kpis.failedLogins24h} danger={data.kpis.failedLogins24h > 0} />;

    case "chart-activity-24h":
      return (
        <>
          <h3>Activity — last 24 hours</h3>
          <Legend
            items={[
              { key: "login", label: "Login", color: EVENT_COLORS.login },
              { key: "login_failed", label: "Login failed", color: EVENT_COLORS.login_failed },
              { key: "session_start", label: "Session start", color: EVENT_COLORS.session_start },
              { key: "access_denied", label: "Access denied", color: EVENT_COLORS.access_denied },
            ]}
          />
          <StackedBarChart
            labelEvery={4}
            data={data.eventsByHour.map((h) => ({
              label: new Date(h.hour).toLocaleTimeString([], { hour: "2-digit" }),
              segments: [
                { key: "login", value: h.login, color: EVENT_COLORS.login },
                { key: "login_failed", value: h.login_failed, color: EVENT_COLORS.login_failed },
                { key: "session_start", value: h.session_start, color: EVENT_COLORS.session_start },
                { key: "access_denied", value: h.access_denied, color: EVENT_COLORS.access_denied },
              ],
            }))}
          />
        </>
      );

    case "chart-sessions-7d":
      return (
        <>
          <h3>Sessions started — last 7 days</h3>
          <BarChart data={data.sessionsByDay.map((d) => ({ label: new Date(d.day).toLocaleDateString([], { weekday: "short" }), value: d.count }))} />
        </>
      );

    case "resource-breakdown": {
      const entries = Object.entries(data.resourcesByType);
      const max = Math.max(...Object.values(data.resourcesByType), 1);
      return (
        <>
          <h3>Resources by type</h3>
          {entries.length === 0 && <div className="empty-state">No resources</div>}
          {entries.map(([t, count]) => (
            <div key={t} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                <span>{t}</span>
                <span className="hint" style={{ margin: 0 }}>{count}</span>
              </div>
              <div style={{ background: "var(--bg)", borderRadius: 4, height: 8 }}>
                <div style={{ width: `${(count / max) * 100}%`, background: "var(--accent)", height: 8, borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </>
      );
    }

    case "recent-denials":
      return (
        <>
          <h3>Recent access denials</h3>
          {data.recentDenials.length === 0 && <div className="empty-state">No denials recorded.</div>}
          {data.recentDenials.length > 0 && (
            <table className="audit-table">
              <thead>
                <tr><th>Time</th><th>User</th><th>Resource</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {data.recentDenials.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.ts).toLocaleString()}</td>
                    <td>{e.username}</td>
                    <td>{e.resourceId ?? "—"}</td>
                    <td>{e.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      );

    case "recent-activity":
      return (
        <>
          <h3>Recent activity</h3>
          {data.recentActivity.length === 0 && <div className="empty-state">Nothing yet.</div>}
          {data.recentActivity.length > 0 && (
            <table className="audit-table">
              <thead>
                <tr><th>Time</th><th>User</th><th>Event</th><th>Details</th></tr>
              </thead>
              <tbody>
                {data.recentActivity.map((e) => (
                  <tr key={e.id}>
                    <td>{new Date(e.ts).toLocaleString()}</td>
                    <td>{e.username}</td>
                    <td><span className="label-chip">{e.eventType}</span></td>
                    <td>{e.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      );

    case "uptime-summary":
      return (
        <>
          <h3>Uptime monitors</h3>
          {data.monitorsList.length === 0 && <div className="empty-state">No monitors configured. Set them up under Admin → Uptime Monitors.</div>}
          {data.monitorsList.map((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--panel-border)" }}>
              <span>
                {m.status === "up" ? "🟢" : m.status === "down" ? "🔴" : "⚪"} {m.name}
              </span>
              <span className="hint" style={{ margin: 0 }}>{m.uptime24h != null ? `${m.uptime24h}% (24h)` : "—"}</span>
            </div>
          ))}
        </>
      );

    case "agent-status":
      return (
        <>
          <h3>Agent status</h3>
          {data.agentsList.length === 0 && <div className="empty-state">No agents connected.</div>}
          {data.agentsList.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--panel-border)" }}>
              <span>🟢 {a.hostname}</span>
              <span className="hint" style={{ margin: 0 }}>{a.lastLatencyMs != null ? `${a.lastLatencyMs}ms` : "—"}</span>
            </div>
          ))}
        </>
      );

    default:
      return <div className="empty-state">Unknown widget type</div>;
  }
}
