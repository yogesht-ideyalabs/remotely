import { useEffect, useState } from "react";
import { fetchDashboard, type DashboardData } from "../api";
import { StackedBarChart, BarChart, Legend } from "../Charts";

const EVENT_COLORS: Record<string, string> = {
  login: "var(--ok)",
  login_failed: "var(--danger)",
  session_start: "var(--accent)",
  access_denied: "#e0a325",
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboard().then(setData).catch((e) => setError(e.message));
    const interval = setInterval(() => fetchDashboard().then(setData).catch(() => {}), 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <h2 className="page-title">Dashboard</h2>
      <p className="page-sub">Live snapshot, computed from the same audit log and session state everything else here uses.</p>
      {error && <div className="error-banner">{error}</div>}
      {!data && !error && <div className="hint">Loading...</div>}

      {data && (
        <>
          <div className="kpi-grid">
            <KpiCard label="Resources" value={data.kpis.totalResources} />
            <KpiCard label="Active sessions" value={data.kpis.activeSessions} accent />
            <KpiCard label="Users" value={data.kpis.totalUsers} />
            <KpiCard label="Agents online" value={data.kpis.agentsOnline} />
            <KpiCard label="Failed logins (24h)" value={data.kpis.failedLogins24h} danger={data.kpis.failedLogins24h > 0} />
          </div>

          <div className="section-card">
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
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div className="section-card">
              <h3>Sessions started — last 7 days</h3>
              <BarChart
                data={data.sessionsByDay.map((d) => ({
                  label: new Date(d.day).toLocaleDateString([], { weekday: "short" }),
                  value: d.count,
                }))}
              />
            </div>
            <div className="section-card">
              <h3>Resources by type</h3>
              {Object.entries(data.resourcesByType).length === 0 && <div className="empty-state">No resources</div>}
              {Object.entries(data.resourcesByType).map(([type, count]) => {
                const max = Math.max(...Object.values(data.resourcesByType), 1);
                return (
                  <div key={type} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                      <span>{type}</span>
                      <span className="hint" style={{ margin: 0 }}>
                        {count}
                      </span>
                    </div>
                    <div style={{ background: "var(--bg)", borderRadius: 4, height: 8 }}>
                      <div
                        style={{
                          width: `${(count / max) * 100}%`,
                          background: "var(--accent)",
                          height: 8,
                          borderRadius: 4,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="section-card">
            <h3>Recent access denials</h3>
            {data.recentDenials.length === 0 && <div className="empty-state">No denials recorded.</div>}
            {data.recentDenials.length > 0 && (
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>User</th>
                    <th>Resource</th>
                    <th>Reason</th>
                  </tr>
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
          </div>
        </>
      )}
    </div>
  );
}

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
