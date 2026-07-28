/**
 * Renders one dashboard widget's actual content — all data comes from the
 * single existing /api/admin/dashboard aggregation (extended with
 * agentsList/monitorsList/recentActivity for this pass) rather than a
 * separate endpoint per widget type, since that data was already computed
 * server-side with the correct tenant/label scoping applied.
 *
 * Author: Yogesh Tiwari
 */

import type { CSSProperties } from "react";
import type { DashboardData } from "../../api";
import type { WidgetType } from "./widgetCatalog";
import { StackedBarChart, BarChart, Legend } from "../../Charts";
import { StatusBadge, type StatusTone } from "../StatusBadge";
import { EmptyState } from "../EmptyState";

const EVENT_COLORS: Record<string, string> = {
  login: "var(--ok)",
  login_failed: "var(--danger)",
  session_start: "var(--accent)",
  access_denied: "var(--warn)",
};

const KPI_STRIPE: Record<string, string> = {
  resources: "var(--accent)",
  sessions: "var(--ok)",
  users: "var(--line-strong)",
  agents: "var(--ok)",
  "failed-logins": "var(--danger)",
};

function KpiCard({ label, value, stripe, danger }: { label: string; value: number; stripe: string; danger?: boolean }) {
  return (
    <div className="kpi-card" style={{ "--kpi-stripe": danger && value > 0 ? "var(--danger)" : stripe } as CSSProperties}>
      <div className="kpi-value" style={danger && value > 0 ? { color: "var(--danger)" } : undefined}>
        {value}
      </div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}

function monitorTone(status: string): StatusTone {
  if (status === "up") return "ok";
  if (status === "down") return "danger";
  return "neutral";
}

function agentTone(a: DashboardData["agentsList"][number]): StatusTone {
  return a.lastLatencyMs != null ? "ok" : "neutral";
}

export function WidgetRenderer({ type, data }: { type: WidgetType; data: DashboardData }) {
  switch (type) {
    case "kpi-resources":
      return <KpiCard label="Resources" value={data.kpis.totalResources} stripe={KPI_STRIPE.resources} />;
    case "kpi-sessions":
      return <KpiCard label="Active sessions" value={data.kpis.activeSessions} stripe={KPI_STRIPE.sessions} />;
    case "kpi-users":
      return <KpiCard label="Users" value={data.kpis.totalUsers} stripe={KPI_STRIPE.users} />;
    case "kpi-agents":
      return <KpiCard label="Agents online" value={data.kpis.agentsOnline} stripe={KPI_STRIPE.agents} />;
    case "kpi-failed-logins":
      return <KpiCard label="Failed logins (24h)" value={data.kpis.failedLogins24h} stripe={KPI_STRIPE["failed-logins"]} danger />;

    case "chart-activity-24h":
      return (
        <div className="widget-title-row">
          <h3>Activity — last 24 hours</h3>
          <div style={{ flexBasis: "100%", order: 3 }}>
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
          </div>
        </div>
      );

    case "chart-sessions-7d":
      return (
        <>
          <h3>Sessions started — last 7 days</h3>
          <BarChart data={data.sessionsByDay.map((d) => ({ label: new Date(d.day).toLocaleDateString([], { weekday: "short" }), value: d.count }))} />
        </>
      );

    case "resource-breakdown": {
      const entries = Object.entries(data.resourcesByType).sort((a, b) => b[1] - a[1]);
      const max = Math.max(...Object.values(data.resourcesByType), 1);
      return (
        <>
          <h3>Resources by type</h3>
          {entries.length === 0 && <EmptyState icon="grid" message="No resources visible to you yet." />}
          {entries.map(([t, count]) => (
            <div key={t} className="bar-item">
              <div className="top">
                <span>{t}</span>
                <span className="n">{count}</span>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(count / max) * 100}%` }} />
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
          {data.recentDenials.length === 0 && <EmptyState icon="check-shield" message="No denials recorded." />}
          {data.recentDenials.length > 0 && (
            <div className="table-wrap">
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
            </div>
          )}
        </>
      );

    case "recent-activity":
      return (
        <>
          <h3>Recent activity</h3>
          {data.recentActivity.length === 0 && <EmptyState icon="list" message="Nothing yet." />}
          {data.recentActivity.length > 0 && (
            <div className="table-wrap">
              <table className="audit-table">
                <thead>
                  <tr><th>Time</th><th>User</th><th>Event</th><th>Details</th></tr>
                </thead>
                <tbody>
                  {data.recentActivity.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.ts).toLocaleString()}</td>
                      <td>{e.username}</td>
                      <td><span className="chip">{e.eventType}</span></td>
                      <td>{e.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      );

    case "uptime-summary":
      return (
        <div className="widget-title-row">
          <h3>Uptime monitors</h3>
          <div style={{ flexBasis: "100%", order: 3 }}>
            {data.monitorsList.length === 0 && (
              <EmptyState icon="radar" message="No monitors configured. Set them up under Admin → Uptime Monitors." />
            )}
            {data.monitorsList.map((m) => (
              <div key={m.id} className="list-row">
                <div className="name">
                  <StatusBadge tone={monitorTone(m.status)}>{""}</StatusBadge>
                  <span className="t">{m.name}</span>
                </div>
                <span className="meta">{m.uptime24h != null ? `${m.uptime24h}% · 24h` : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      );

    case "agent-status":
      return (
        <>
          <h3>Agent status</h3>
          {data.agentsList.length === 0 && <EmptyState icon="bars" message="No agents connected." />}
          {data.agentsList.map((a) => (
            <div key={a.id} className="list-row">
              <div className="name">
                <StatusBadge tone={agentTone(a)}>{""}</StatusBadge>
                <span className="t">{a.hostname}</span>
              </div>
              <span className="meta">{a.lastLatencyMs != null ? `${a.lastLatencyMs}ms` : "reconnecting"}</span>
            </div>
          ))}
        </>
      );

    default:
      return <EmptyState message="Unknown widget type." />;
  }
}
