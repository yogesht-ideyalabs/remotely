/**
 * Monitoring Dashboard — built-in Prometheus+Grafana replacement
 *
 * Real-time system metrics visualization with:
 * - Host overview (CPU, memory, disk, network at a glance)
 * - Time-series charts (zoomable, multiple metrics per chart)
 * - Alert rules management (create/edit/delete)
 * - Host selector + time range picker
 *
 * Author: Yogesh Tiwari
 */

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "../api";

interface MetricSeries {
  host: string;
  name: string;
  points: { ts: number; value: number }[];
}

interface MetricAlert {
  id: string;
  name: string;
  metric: string;
  condition: string;
  threshold: number;
  durationSeconds: number;
  hostFilter: string;
  severity: string;
  enabled: boolean;
  lastTriggeredAt: number;
  state: string;
  createdAt: number;
  createdBy: string;
}

interface LatestMetric {
  name: string;
  value: number;
  ts: number;
}

type TimeRange = "15m" | "1h" | "6h" | "24h" | "7d";

const TIME_RANGES: { label: string; value: TimeRange; ms: number }[] = [
  { label: "15 min", value: "15m", ms: 15 * 60 * 1000 },
  { label: "1 hour", value: "1h", ms: 60 * 60 * 1000 },
  { label: "6 hours", value: "6h", ms: 6 * 60 * 60 * 1000 },
  { label: "24 hours", value: "24h", ms: 24 * 60 * 60 * 1000 },
  { label: "7 days", value: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
];

export default function Monitoring() {
  const [hosts, setHosts] = useState<string[]>([]);
  const [selectedHost, setSelectedHost] = useState<string>("");
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");
  const [latestMetrics, setLatestMetrics] = useState<LatestMetric[]>([]);
  const [alerts, setAlerts] = useState<MetricAlert[]>([]);
  const [chartData, setChartData] = useState<Record<string, MetricSeries[]>>({});
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"overview" | "charts" | "alerts">("overview");

  // Alert form
  const [showAlertForm, setShowAlertForm] = useState(false);
  const [alertForm, setAlertForm] = useState({ name: "", metric: "cpu_usage_percent", condition: "above", threshold: "80", durationSeconds: "60", hostFilter: "", severity: "warning" });

  useEffect(() => {
    apiFetch("/api/metrics/hosts").then((h) => { setHosts(h); if (h.length && !selectedHost) setSelectedHost(h[0]); }).catch(() => {});
    apiFetch("/api/metrics/alerts").then(setAlerts).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedHost) return;
    apiFetch(`/api/metrics/latest/${encodeURIComponent(selectedHost)}`).then(setLatestMetrics).catch(() => {});
  }, [selectedHost]);

  const loadChart = useCallback(async (metricName: string) => {
    const range = TIME_RANGES.find((r) => r.value === timeRange)!;
    const now = Date.now();
    const series = await apiFetch("/api/metrics/query", {
      method: "POST",
      body: JSON.stringify({ host: selectedHost || undefined, name: metricName, from: now - range.ms, to: now }),
    });
    setChartData((prev) => ({ ...prev, [metricName]: series }));
  }, [selectedHost, timeRange]);

  // Load key charts when tab changes
  useEffect(() => {
    if (tab === "charts" && selectedHost) {
      setLoading(true);
      Promise.all([
        loadChart("cpu_usage_percent"),
        loadChart("memory_usage_percent"),
        loadChart("disk_usage_percent"),
        loadChart("load_avg_1m"),
      ]).finally(() => setLoading(false));
    }
  }, [tab, selectedHost, timeRange, loadChart]);

  async function createAlertRule(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch("/api/metrics/alerts", {
        method: "POST",
        body: JSON.stringify({ ...alertForm, threshold: Number(alertForm.threshold), durationSeconds: Number(alertForm.durationSeconds) }),
      });
      setShowAlertForm(false);
      setAlertForm({ name: "", metric: "cpu_usage_percent", condition: "above", threshold: "80", durationSeconds: "60", hostFilter: "", severity: "warning" });
      const updated = await apiFetch("/api/metrics/alerts");
      setAlerts(updated);
    } catch {}
  }

  async function deleteAlertRule(id: string) {
    if (!confirm("Delete this alert rule?")) return;
    await apiFetch(`/api/metrics/alerts/${id}`, { method: "DELETE" });
    setAlerts((a) => a.filter((x) => x.id !== id));
  }

  function getMetricValue(name: string): number | null {
    const m = latestMetrics.find((l) => l.name === name);
    return m ? m.value : null;
  }

  function formatBytes(bytes: number | null): string {
    if (bytes === null) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }

  return (
    <div className="page monitoring-page">
      <div className="monitoring-header">
        <h1>📊 Monitoring</h1>
        <div className="monitoring-controls">
          <div className="monitoring-control-group">
            <label className="monitoring-control-label">Host</label>
            <select value={selectedHost} onChange={(e) => setSelectedHost(e.target.value)}>
              {hosts.length === 0 && <option value="">No hosts reporting yet</option>}
              {hosts.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div className="monitoring-control-group">
            <label className="monitoring-control-label">Time Range</label>
            <div className="time-range-picker">
              {TIME_RANGES.map((r) => (
                <button key={r.value} className={timeRange === r.value ? "active" : ""} onClick={() => setTimeRange(r.value)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="monitoring-tabs">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button>
        <button className={tab === "charts" ? "active" : ""} onClick={() => setTab("charts")}>Charts</button>
        <button className={tab === "alerts" ? "active" : ""} onClick={() => setTab("alerts")}>Alerts ({alerts.filter((a) => a.state === "firing").length} firing)</button>
      </div>

      {tab === "overview" && (
        <div className="metrics-overview">
          {hosts.length === 0 ? (
            <div className="empty-state-box">
              <h3>No metrics data yet</h3>
              <p>Metrics are collected automatically by Remotely agents. Deploy an agent with the default config — metrics reporting is enabled out of the box (every 15s).</p>
              <p>Or ingest manually: <code>POST /api/metrics/ingest</code> with a JSON body.</p>
            </div>
          ) : (
            <>
              <div className="metrics-cards">
                <MetricCard label="CPU Usage" value={getMetricValue("cpu_usage_percent")} unit="%" color={getMetricValue("cpu_usage_percent")! > 80 ? "#ef4444" : "#3ecf8e"} />
                <MetricCard label="Memory" value={getMetricValue("memory_usage_percent")} unit="%" color={getMetricValue("memory_usage_percent")! > 85 ? "#ef4444" : "#5b8cff"} />
                <MetricCard label="Disk" value={getMetricValue("disk_usage_percent")} unit="%" color={getMetricValue("disk_usage_percent")! > 90 ? "#ef4444" : "#f59e0b"} />
                <MetricCard label="Load (1m)" value={getMetricValue("load_avg_1m")} unit="" color="#8b5cf6" />
                <MetricCard label="Processes" value={getMetricValue("process_count")} unit="" color="#06b6d4" />
                <MetricCard label="Uptime" value={getMetricValue("uptime_seconds") ? Math.floor(getMetricValue("uptime_seconds")! / 3600) : null} unit="hrs" color="#3ecf8e" />
              </div>
              <div className="metrics-detail-cards">
                <div className="detail-card">
                  <h4>Memory</h4>
                  <p>{formatBytes(getMetricValue("memory_used_bytes"))} / {formatBytes(getMetricValue("memory_total_bytes"))}</p>
                </div>
                <div className="detail-card">
                  <h4>Disk (/)</h4>
                  <p>{formatBytes(getMetricValue("disk_used_bytes"))} / {formatBytes(getMetricValue("disk_total_bytes"))}</p>
                </div>
                <div className="detail-card">
                  <h4>Network</h4>
                  <p>↓ {formatBytes(getMetricValue("network_rx_bytes_per_sec"))}/s &nbsp; ↑ {formatBytes(getMetricValue("network_tx_bytes_per_sec"))}/s</p>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "charts" && (
        <div className="metrics-charts">
          {loading && <div className="loading-bar">Loading charts...</div>}
          {["cpu_usage_percent", "memory_usage_percent", "disk_usage_percent", "load_avg_1m"].map((metric) => (
            <MiniChart key={metric} name={metric} series={chartData[metric] || []} />
          ))}
        </div>
      )}

      {tab === "alerts" && (
        <div className="metrics-alerts">
          <div className="alerts-header">
            <h3>Alert Rules</h3>
            <button className="btn-primary" onClick={() => setShowAlertForm(!showAlertForm)}>+ New Alert</button>
          </div>

          {showAlertForm && (
            <form className="alert-form" onSubmit={createAlertRule}>
              <input placeholder="Alert name" value={alertForm.name} onChange={(e) => setAlertForm({ ...alertForm, name: e.target.value })} required />
              <select value={alertForm.metric} onChange={(e) => setAlertForm({ ...alertForm, metric: e.target.value })}>
                <option value="cpu_usage_percent">CPU Usage %</option>
                <option value="memory_usage_percent">Memory Usage %</option>
                <option value="disk_usage_percent">Disk Usage %</option>
                <option value="load_avg_1m">Load Average (1m)</option>
                <option value="network_rx_bytes_per_sec">Network RX bytes/s</option>
                <option value="network_tx_bytes_per_sec">Network TX bytes/s</option>
              </select>
              <select value={alertForm.condition} onChange={(e) => setAlertForm({ ...alertForm, condition: e.target.value })}>
                <option value="above">Above</option>
                <option value="below">Below</option>
              </select>
              <input type="number" placeholder="Threshold" value={alertForm.threshold} onChange={(e) => setAlertForm({ ...alertForm, threshold: e.target.value })} required />
              <input type="number" placeholder="Duration (sec)" value={alertForm.durationSeconds} onChange={(e) => setAlertForm({ ...alertForm, durationSeconds: e.target.value })} />
              <select value={alertForm.severity} onChange={(e) => setAlertForm({ ...alertForm, severity: e.target.value })}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
              <input placeholder="Host filter (optional)" value={alertForm.hostFilter} onChange={(e) => setAlertForm({ ...alertForm, hostFilter: e.target.value })} />
              <button className="btn-primary" type="submit">Create Alert</button>
            </form>
          )}

          <div className="alerts-list">
            {alerts.length === 0 && <p className="empty-state">No alert rules configured.</p>}
            {alerts.map((a) => (
              <div key={a.id} className={`alert-card alert-${a.state}`}>
                <div className="alert-card-header">
                  <span className="alert-name">{a.name}</span>
                  <span className={`alert-state-badge state-${a.state}`}>{a.state.toUpperCase()}</span>
                </div>
                <div className="alert-rule">{a.metric} {a.condition} {a.threshold} for {a.durationSeconds}s</div>
                <div className="alert-meta">
                  Severity: {a.severity} • {a.hostFilter ? `Host: ${a.hostFilter}` : "All hosts"} • Created by {a.createdBy}
                </div>
                <button className="btn-sm btn-danger" onClick={() => deleteAlertRule(a.id)}>Delete</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function MetricCard({ label, value, unit, color }: { label: string; value: number | null; unit: string; color: string }) {
  return (
    <div className="metric-card">
      <div className="metric-card-value" style={{ color }}>{value !== null ? value.toFixed(1) : "—"}<span className="metric-unit">{unit}</span></div>
      <div className="metric-card-label">{label}</div>
    </div>
  );
}

function MiniChart({ name, series }: { name: string; series: MetricSeries[] }) {
  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length === 0) return (
    <div className="mini-chart"><div className="mini-chart-header"><h4>{formatMetricName(name)}</h4></div><p className="empty-state" style={{ padding: "20px 0" }}>No data</p></div>
  );

  const maxVal = Math.max(...allPoints.map((p) => p.value), 1);
  const minVal = Math.min(...allPoints.map((p) => p.value));
  const range = maxVal - minVal || 1;
  const width = 600;
  const height = 120;
  const padTop = 10;
  const padBot = 10;
  const usableHeight = height - padTop - padBot;

  // Build SVG path
  const pathD = allPoints.map((p, i) => {
    const x = (i / Math.max(allPoints.length - 1, 1)) * width;
    const y = padTop + usableHeight - ((p.value - minVal) / range) * usableHeight;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");

  // Fill area path (same line + close at bottom)
  const firstX = 0;
  const lastX = width;
  const fillD = `${pathD} L ${lastX} ${height} L ${firstX} ${height} Z`;

  return (
    <div className="mini-chart">
      <div className="mini-chart-header">
        <h4>{formatMetricName(name)}</h4>
        <span className="mini-chart-latest">{allPoints[allPoints.length - 1]?.value.toFixed(1)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="mini-chart-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${name}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fillD} fill={`url(#grad-${name})`} />
        <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="mini-chart-range"><span>{minVal.toFixed(1)}</span><span>{maxVal.toFixed(1)}</span></div>
    </div>
  );
}

function formatMetricName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
