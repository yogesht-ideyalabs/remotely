/**
 * Uptime monitoring — Uptime Kuma-style HTTP/TCP/keyword/agent-heartbeat
 * checks on a schedule, with status-change callbacks for the caller
 * (index.ts) to wire into audit logging, notifications, and SMTP alert
 * email. Deliberately does NOT apply the SSRF private-IP blocklist that
 * webhookDelivery.ts uses for admin-configured webhook DESTINATIONS —
 * monitoring your own internal-only services (a database on a private
 * subnet, an internal admin panel) is the primary reason to self-host an
 * uptime tool at all, unlike a webhook target, which has no legitimate
 * reason to point at link-local metadata endpoints.
 *
 * Author: Yogesh Tiwari
 */

import net from "node:net";
import crypto from "node:crypto";
import { loadTable, saveRow, deleteRow } from "./db.js";
import { agents } from "./state.js";

export type MonitorType = "http" | "tcp" | "keyword" | "heartbeat";
export type MonitorStatus = "up" | "down" | "pending";

export interface Monitor {
  id: string;
  name: string;
  type: MonitorType;
  enabled: boolean;
  intervalSeconds: number;
  timeoutMs: number;
  // Number of consecutive failures tolerated before flipping to "down" —
  // avoids flapping alerts on one transient blip. 0 = mark down immediately.
  retries: number;

  // http / keyword
  url?: string;
  expectedStatusMin?: number;
  expectedStatusMax?: number;
  // keyword only
  keyword?: string;
  keywordShouldExist?: boolean;

  // tcp
  host?: string;
  port?: number;

  // heartbeat
  agentId?: string;

  createdBy: string;
  createdAt: number;
  updatedAt: number;

  // Runtime status, persisted so it survives a restart instead of every
  // monitor resetting to "pending" on every deploy.
  status: MonitorStatus;
  lastCheckedAt: number | null;
  lastStatusChangeAt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastResponseTimeMs: number | null;
}

export interface MonitorCheck {
  id: string;
  monitorId: string;
  ts: number;
  status: "up" | "down";
  responseTimeMs: number | null;
  message: string;
}

const MAX_CHECKS_PER_MONITOR = 200;

const monitors: Monitor[] = loadTable<Monitor>("monitors");
// One row per monitor, value = bounded array of its own recent checks —
// simpler than a real per-check table given db.ts's key+blob shape, and
// this app's monitor counts are small (self-hosted, admin-configured).
const checksByMonitor = new Map<string, MonitorCheck[]>(loadTable<{ monitorId: string; checks: MonitorCheck[] }>("monitorChecks").map((r) => [r.monitorId, r.checks]));

export function listMonitors(): Monitor[] {
  return monitors;
}

export function getMonitor(id: string): Monitor | undefined {
  return monitors.find((m) => m.id === id);
}

export function createMonitor(data: Omit<Monitor, "id" | "createdBy" | "createdAt" | "updatedAt" | "status" | "lastCheckedAt" | "lastStatusChangeAt" | "consecutiveFailures" | "lastError" | "lastResponseTimeMs">, createdBy: string): Monitor {
  const monitor: Monitor = {
    ...data,
    id: crypto.randomUUID(),
    createdBy,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "pending",
    lastCheckedAt: null,
    lastStatusChangeAt: null,
    consecutiveFailures: 0,
    lastError: null,
    lastResponseTimeMs: null,
  };
  monitors.push(monitor);
  saveRow("monitors", monitor.id, monitor);
  return monitor;
}

export function updateMonitor(id: string, changes: Partial<Omit<Monitor, "id" | "createdBy" | "createdAt">>): Monitor | undefined {
  const monitor = getMonitor(id);
  if (!monitor) return undefined;
  Object.assign(monitor, changes, { updatedAt: Date.now() });
  saveRow("monitors", monitor.id, monitor);
  return monitor;
}

export function deleteMonitor(id: string): Monitor | undefined {
  const idx = monitors.findIndex((m) => m.id === id);
  if (idx === -1) return undefined;
  const [removed] = monitors.splice(idx, 1);
  deleteRow("monitors", id);
  checksByMonitor.delete(id);
  deleteRow("monitorChecks", id);
  return removed;
}

export function getMonitorChecks(monitorId: string): MonitorCheck[] {
  return checksByMonitor.get(monitorId) ?? [];
}

function appendCheck(monitorId: string, check: MonitorCheck) {
  const list = checksByMonitor.get(monitorId) ?? [];
  list.push(check);
  if (list.length > MAX_CHECKS_PER_MONITOR) list.splice(0, list.length - MAX_CHECKS_PER_MONITOR);
  checksByMonitor.set(monitorId, list);
  saveRow("monitorChecks", monitorId, { monitorId, checks: list });
}

// Fraction of checks in the last `windowMs` that were "up" — a simple
// count-based ratio (not duration-weighted), which is the same
// approximation Uptime Kuma's own dashboard uses for its 24h/30d numbers.
export function computeUptimePercent(monitorId: string, windowMs: number): number | null {
  const cutoff = Date.now() - windowMs;
  const recent = getMonitorChecks(monitorId).filter((c) => c.ts >= cutoff);
  if (recent.length === 0) return null;
  const upCount = recent.filter((c) => c.status === "up").length;
  return Math.round((upCount / recent.length) * 1000) / 10;
}

interface CheckResult {
  ok: boolean;
  responseTimeMs: number | null;
  message: string;
}

function checkTcp(host: string, port: number, timeoutMs: number): Promise<CheckResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, responseTimeMs: Date.now() - start, message: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve({ ok: true, responseTimeMs: Date.now() - start, message: "connected" });
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      // net.connect() resolving "localhost" (or any host with more than one
      // A/AAAA record) tries each address and, if all fail, throws an
      // AggregateError whose own top-level .message is empty — the real
      // per-attempt reasons live in .errors[]. Confirmed live: connecting to
      // a closed port on "localhost" produced message="" here, which would
      // otherwise have shown as a blank, useless error in the monitor list.
      const aggregate = err as NodeJS.ErrnoException & { errors?: Error[] };
      const message = aggregate.message || aggregate.errors?.map((e) => e.message).join("; ") || aggregate.code || "connection failed";
      resolve({ ok: false, responseTimeMs: Date.now() - start, message });
    });
  });
}

async function checkHttp(m: Monitor): Promise<CheckResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), m.timeoutMs);
  try {
    const res = await fetch(m.url!, { signal: controller.signal, redirect: "follow" });
    const elapsed = Date.now() - start;
    const min = m.expectedStatusMin ?? 200;
    const max = m.expectedStatusMax ?? 299;
    if (res.status < min || res.status > max) {
      return { ok: false, responseTimeMs: elapsed, message: `HTTP ${res.status} (expected ${min}-${max})` };
    }
    if (m.type === "keyword") {
      const body = await res.text();
      const has = body.includes(m.keyword ?? "");
      const wantExist = m.keywordShouldExist ?? true;
      if (has !== wantExist) {
        return {
          ok: false,
          responseTimeMs: elapsed,
          message: wantExist ? `keyword "${m.keyword}" not found in response` : `keyword "${m.keyword}" found (expected absent)`,
        };
      }
    }
    return { ok: true, responseTimeMs: elapsed, message: `HTTP ${res.status}` };
  } catch (err) {
    const elapsed = Date.now() - start;
    if (err instanceof Error && err.name === "AbortError") return { ok: false, responseTimeMs: elapsed, message: `timeout after ${m.timeoutMs}ms` };
    return { ok: false, responseTimeMs: elapsed, message: err instanceof Error ? err.message : "request failed" };
  } finally {
    clearTimeout(timer);
  }
}

function checkHeartbeat(m: Monitor): CheckResult {
  const agent = m.agentId ? agents.get(m.agentId) : undefined;
  if (!agent) return { ok: false, responseTimeMs: null, message: "agent not connected" };
  // An agent that's connected but hasn't heartbeat-pinged in a while is as
  // good as down — same "stale connection" logic Agent Health already uses,
  // just re-applied here as a monitor's pass/fail.
  const staleMs = Math.max(m.intervalSeconds * 1000 * 2, 60_000);
  const sinceLastSeen = Date.now() - agent.lastSeen;
  if (sinceLastSeen > staleMs) {
    return { ok: false, responseTimeMs: null, message: `no heartbeat in ${Math.round(sinceLastSeen / 1000)}s` };
  }
  return { ok: true, responseTimeMs: agent.lastLatencyMs, message: "agent connected" };
}

async function performCheck(m: Monitor): Promise<CheckResult> {
  switch (m.type) {
    case "http":
    case "keyword":
      return checkHttp(m);
    case "tcp":
      return checkTcp(m.host!, m.port!, m.timeoutMs);
    case "heartbeat":
      return checkHeartbeat(m);
  }
}

export type StatusChangeListener = (monitor: Monitor, previousStatus: MonitorStatus, check: MonitorCheck) => void;

export async function runMonitorCheck(m: Monitor, onStatusChange?: StatusChangeListener): Promise<Monitor> {
  const result = await performCheck(m);
  const now = Date.now();
  const previousStatus = m.status;

  let consecutiveFailures = m.consecutiveFailures;
  let newStatus: MonitorStatus = m.status;
  if (result.ok) {
    consecutiveFailures = 0;
    newStatus = "up";
  } else {
    consecutiveFailures += 1;
    // While still within the retry budget, hold the previous status (unless
    // this is the very first check ever, which has no "previous" to hold).
    if (consecutiveFailures > m.retries || m.status === "pending") newStatus = "down";
  }

  const statusChanged = newStatus !== previousStatus;
  const updated = updateMonitor(m.id, {
    status: newStatus,
    lastCheckedAt: now,
    lastStatusChangeAt: statusChanged ? now : m.lastStatusChangeAt,
    consecutiveFailures,
    lastError: result.ok ? null : result.message,
    lastResponseTimeMs: result.responseTimeMs,
  })!;

  const check: MonitorCheck = { id: crypto.randomUUID(), monitorId: m.id, ts: now, status: result.ok ? "up" : "down", responseTimeMs: result.responseTimeMs, message: result.message };
  appendCheck(m.id, check);

  if (statusChanged && onStatusChange) onStatusChange(updated, previousStatus, check);
  return updated;
}

const CHECK_TICK_MS = 15_000;
let schedulerStarted = false;

// Ticks every 15s and runs any monitor whose interval has elapsed since its
// last check — a single shared ticker rather than one setInterval per
// monitor, so enabling/disabling/editing monitors never needs to
// re-schedule timers.
export function startMonitorScheduler(onStatusChange: StatusChangeListener) {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const tick = async () => {
    const now = Date.now();
    for (const m of monitors) {
      if (!m.enabled) continue;
      const due = !m.lastCheckedAt || now - m.lastCheckedAt >= m.intervalSeconds * 1000;
      if (!due) continue;
      try {
        await runMonitorCheck(m, onStatusChange);
      } catch {
        // A single monitor's check throwing (bug in a check runner, etc.)
        // must not take down the whole scheduler tick for every other one.
      }
    }
  };
  setInterval(tick, CHECK_TICK_MS).unref();
  setTimeout(tick, 3000).unref();
}
