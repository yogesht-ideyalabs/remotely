/**
 * Built-in Metrics & Monitoring System
 *
 * Replaces the need for separate Prometheus + Grafana deployment.
 * Agents collect system metrics (CPU, memory, disk, network, processes)
 * and report them to the control plane. The control plane stores time-series
 * data, evaluates alert rules, and serves a dashboard API.
 *
 * Architecture:
 *   Agent → collects metrics every N seconds (configurable)
 *         → reports via POST /api/metrics/ingest (or over existing WS)
 *   Control Plane → stores in SQLite (ring-buffer, configurable retention)
 *                 → evaluates alert rules on every ingest
 *                 → serves query API for dashboards
 *   Web UI → real-time charts, configurable dashboards, alert management
 *
 * Metric types (same as Prometheus):
 *   - gauge: point-in-time value (CPU %, memory used, disk free)
 *   - counter: monotonically increasing (bytes sent, requests total)
 *   - histogram: distribution (request latency buckets)
 *
 * Author: Yogesh Tiwari
 */

import { db } from "./db.js";
import { logAudit } from "./store.js";

// ─── Schema (created on first import) ────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS metric_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    host TEXT NOT NULL,
    name TEXT NOT NULL,
    value REAL NOT NULL,
    labels TEXT DEFAULT '{}',
    ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_metric_points_host_name_ts ON metric_points(host, name, ts);
  CREATE INDEX IF NOT EXISTS idx_metric_points_ts ON metric_points(ts);

  CREATE TABLE IF NOT EXISTS metric_alerts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    metric TEXT NOT NULL,
    condition TEXT NOT NULL,
    threshold REAL NOT NULL,
    duration_seconds INTEGER DEFAULT 60,
    host_filter TEXT DEFAULT '',
    severity TEXT DEFAULT 'warning',
    enabled INTEGER DEFAULT 1,
    last_triggered_at INTEGER DEFAULT 0,
    state TEXT DEFAULT 'ok',
    created_at INTEGER NOT NULL,
    created_by TEXT NOT NULL
  );
`);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MetricPoint {
  host: string;
  name: string;
  value: number;
  labels?: Record<string, string>;
  ts: number;
}

export interface MetricAlert {
  id: string;
  name: string;
  metric: string;
  condition: "above" | "below" | "equals";
  threshold: number;
  durationSeconds: number;
  hostFilter: string;
  severity: "info" | "warning" | "critical";
  enabled: boolean;
  lastTriggeredAt: number;
  state: "ok" | "firing" | "pending";
  createdAt: number;
  createdBy: string;
}

export interface MetricQuery {
  host?: string;
  name: string;
  from: number;    // unix ms
  to: number;      // unix ms
  step?: number;   // downsample to N points (default: 300)
}

export interface MetricSeries {
  host: string;
  name: string;
  points: { ts: number; value: number }[];
}

// ─── Ingestion ───────────────────────────────────────────────────────────────

const insertStmt = db.prepare(
  "INSERT INTO metric_points (host, name, value, labels, ts) VALUES (?, ?, ?, ?, ?)"
);

export function ingestMetrics(points: MetricPoint[]): number {
  let count = 0;
  for (const p of points) {
    insertStmt.run(p.host, p.name, p.value, JSON.stringify(p.labels || {}), p.ts || Date.now());
    count++;
  }
  return count;
}

// ─── Querying ────────────────────────────────────────────────────────────────

export function queryMetrics(query: MetricQuery): MetricSeries[] {
  const { host, name, from, to, step } = query;
  const maxPoints = step || 300;

  let sql = "SELECT host, name, value, ts FROM metric_points WHERE name = ? AND ts >= ? AND ts <= ?";
  const params: (string | number)[] = [name, from, to];

  if (host) {
    sql += " AND host = ?";
    params.push(host);
  }

  sql += " ORDER BY host, ts";
  const rows = db.prepare(sql).all(...params) as { host: string; name: string; value: number; ts: number }[];

  // Group by host
  const byHost = new Map<string, { ts: number; value: number }[]>();
  for (const row of rows) {
    if (!byHost.has(row.host)) byHost.set(row.host, []);
    byHost.get(row.host)!.push({ ts: row.ts, value: row.value });
  }

  // Downsample if too many points
  const series: MetricSeries[] = [];
  for (const [h, points] of byHost) {
    const downsampled = points.length > maxPoints ? downsample(points, maxPoints) : points;
    series.push({ host: h, name, points: downsampled });
  }

  return series;
}

/**
 * List all distinct metric names (for autocomplete/discovery).
 */
export function listMetricNames(): string[] {
  const rows = db.prepare("SELECT DISTINCT name FROM metric_points ORDER BY name").all() as { name: string }[];
  return rows.map((r) => r.name);
}

/**
 * List all distinct hosts reporting metrics.
 */
export function listMetricHosts(): string[] {
  const rows = db.prepare("SELECT DISTINCT host FROM metric_points ORDER BY host").all() as { host: string }[];
  return rows.map((r) => r.host);
}

/**
 * Get the latest value for each metric on a host (for "current state" display).
 */
export function latestMetrics(host: string): { name: string; value: number; ts: number }[] {
  const rows = db.prepare(`
    SELECT name, value, ts FROM metric_points
    WHERE host = ? AND ts > ?
    GROUP BY name HAVING ts = MAX(ts)
    ORDER BY name
  `).all(host, Date.now() - 300_000) as { name: string; value: number; ts: number }[];
  return rows;
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

export function listAlerts(): MetricAlert[] {
  const rows = db.prepare("SELECT * FROM metric_alerts ORDER BY created_at DESC").all() as any[];
  return rows.map(rowToAlert);
}

export function getAlert(id: string): MetricAlert | undefined {
  const row = db.prepare("SELECT * FROM metric_alerts WHERE id = ?").get(id) as any;
  return row ? rowToAlert(row) : undefined;
}

export function createAlert(alert: Omit<MetricAlert, "lastTriggeredAt" | "state" | "createdAt">): MetricAlert {
  const now = Date.now();
  db.prepare(`
    INSERT INTO metric_alerts (id, name, metric, condition, threshold, duration_seconds, host_filter, severity, enabled, last_triggered_at, state, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'ok', ?, ?)
  `).run(alert.id, alert.name, alert.metric, alert.condition, alert.threshold, alert.durationSeconds, alert.hostFilter, alert.severity, alert.enabled ? 1 : 0, now, alert.createdBy);

  return { ...alert, lastTriggeredAt: 0, state: "ok", createdAt: now };
}

export function updateAlert(id: string, changes: Partial<MetricAlert>): boolean {
  const existing = getAlert(id);
  if (!existing) return false;
  const merged = { ...existing, ...changes };
  db.prepare(`
    UPDATE metric_alerts SET name=?, metric=?, condition=?, threshold=?, duration_seconds=?, host_filter=?, severity=?, enabled=?
    WHERE id=?
  `).run(merged.name, merged.metric, merged.condition, merged.threshold, merged.durationSeconds, merged.hostFilter, merged.severity, merged.enabled ? 1 : 0, id);
  return true;
}

export function deleteAlert(id: string): boolean {
  const result = db.prepare("DELETE FROM metric_alerts WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * Evaluate all enabled alerts against recent data.
 * Called after every metric ingest batch.
 */
export function evaluateAlerts(): { firing: MetricAlert[]; resolved: MetricAlert[] } {
  const alerts = listAlerts().filter((a) => a.enabled);
  const firing: MetricAlert[] = [];
  const resolved: MetricAlert[] = [];
  const now = Date.now();

  for (const alert of alerts) {
    const lookback = alert.durationSeconds * 1000;
    let sql = "SELECT AVG(value) as avg_val FROM metric_points WHERE name = ? AND ts > ?";
    const params: (string | number)[] = [alert.metric, now - lookback];

    if (alert.hostFilter) {
      sql += " AND host LIKE ?";
      params.push(`%${alert.hostFilter}%`);
    }

    const row = db.prepare(sql).get(...params) as { avg_val: number | null } | undefined;
    const avgVal = row?.avg_val;

    if (avgVal === null || avgVal === undefined) continue;

    let isFiring = false;
    switch (alert.condition) {
      case "above": isFiring = avgVal > alert.threshold; break;
      case "below": isFiring = avgVal < alert.threshold; break;
      case "equals": isFiring = Math.abs(avgVal - alert.threshold) < 0.001; break;
    }

    if (isFiring && alert.state !== "firing") {
      db.prepare("UPDATE metric_alerts SET state = 'firing', last_triggered_at = ? WHERE id = ?").run(now, alert.id);
      firing.push({ ...alert, state: "firing", lastTriggeredAt: now });
      logAudit("system", "metric_alert_firing", alert.id, `${alert.name}: ${alert.metric} ${alert.condition} ${alert.threshold} (avg=${avgVal.toFixed(2)})`);
    } else if (!isFiring && alert.state === "firing") {
      db.prepare("UPDATE metric_alerts SET state = 'ok' WHERE id = ?").run(alert.id);
      resolved.push({ ...alert, state: "ok" });
      logAudit("system", "metric_alert_resolved", alert.id, `${alert.name} resolved`);
    }
  }

  return { firing, resolved };
}

// ─── Retention (cleanup old data) ────────────────────────────────────────────

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days default

export function pruneOldMetrics(retentionMs: number = RETENTION_MS): number {
  const cutoff = Date.now() - retentionMs;
  const result = db.prepare("DELETE FROM metric_points WHERE ts < ?").run(cutoff);
  return Number(result.changes);
}

// Run retention cleanup every hour
setInterval(() => pruneOldMetrics(), 60 * 60 * 1000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function downsample(points: { ts: number; value: number }[], maxPoints: number): { ts: number; value: number }[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const result: { ts: number; value: number }[] = [];
  for (let i = 0; i < points.length; i += step) {
    const bucket = points.slice(i, i + step);
    const avg = bucket.reduce((sum, p) => sum + p.value, 0) / bucket.length;
    result.push({ ts: bucket[Math.floor(bucket.length / 2)].ts, value: avg });
  }
  return result;
}

function rowToAlert(row: any): MetricAlert {
  return {
    id: row.id,
    name: row.name,
    metric: row.metric,
    condition: row.condition,
    threshold: row.threshold,
    durationSeconds: row.duration_seconds,
    hostFilter: row.host_filter,
    severity: row.severity,
    enabled: Boolean(row.enabled),
    lastTriggeredAt: row.last_triggered_at,
    state: row.state,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}
