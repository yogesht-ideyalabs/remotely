/**
 * System Metrics Collector for the Remotely Agent
 *
 * Collects CPU, memory, disk, network, and load metrics every N seconds
 * and reports them to the control plane's /api/metrics/ingest endpoint.
 *
 * Replaces the need for a separate Prometheus node_exporter + Prometheus server.
 *
 * Author: Yogesh Tiwari
 */

import os from "node:os";
import { execSync } from "node:child_process";

export interface MetricPoint {
  host: string;
  name: string;
  value: number;
  labels?: Record<string, string>;
  ts: number;
}

let prevCpuTimes: { idle: number; total: number } | null = null;
let prevNetStats: { rx: number; tx: number; ts: number } | null = null;

/**
 * Collect all system metrics.
 */
export function collectSystemMetrics(hostname: string): MetricPoint[] {
  const now = Date.now();
  const points: MetricPoint[] = [];

  // CPU usage (%)
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  if (prevCpuTimes) {
    const idleDelta = idle - prevCpuTimes.idle;
    const totalDelta = total - prevCpuTimes.total;
    const cpuPercent = totalDelta > 0 ? ((1 - idleDelta / totalDelta) * 100) : 0;
    points.push({ host: hostname, name: "cpu_usage_percent", value: Math.round(cpuPercent * 100) / 100, ts: now });
  }
  prevCpuTimes = { idle, total };

  // CPU count
  points.push({ host: hostname, name: "cpu_count", value: cpus.length, ts: now });

  // Memory
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  points.push({ host: hostname, name: "memory_total_bytes", value: totalMem, ts: now });
  points.push({ host: hostname, name: "memory_used_bytes", value: usedMem, ts: now });
  points.push({ host: hostname, name: "memory_free_bytes", value: freeMem, ts: now });
  points.push({ host: hostname, name: "memory_usage_percent", value: Math.round((usedMem / totalMem) * 10000) / 100, ts: now });

  // Load average (Unix only)
  const loadAvg = os.loadavg();
  points.push({ host: hostname, name: "load_avg_1m", value: loadAvg[0], ts: now });
  points.push({ host: hostname, name: "load_avg_5m", value: loadAvg[1], ts: now });
  points.push({ host: hostname, name: "load_avg_15m", value: loadAvg[2], ts: now });

  // Uptime
  points.push({ host: hostname, name: "uptime_seconds", value: os.uptime(), ts: now });

  // Disk usage (Linux/macOS)
  try {
    const dfOutput = execSync("df -k / 2>/dev/null", { encoding: "utf8", timeout: 5000 });
    const lines = dfOutput.trim().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      const totalDisk = parseInt(parts[1], 10) * 1024; // KB to bytes
      const usedDisk = parseInt(parts[2], 10) * 1024;
      const freeDisk = parseInt(parts[3], 10) * 1024;
      points.push({ host: hostname, name: "disk_total_bytes", value: totalDisk, labels: { mount: "/" }, ts: now });
      points.push({ host: hostname, name: "disk_used_bytes", value: usedDisk, labels: { mount: "/" }, ts: now });
      points.push({ host: hostname, name: "disk_free_bytes", value: freeDisk, labels: { mount: "/" }, ts: now });
      points.push({ host: hostname, name: "disk_usage_percent", value: totalDisk > 0 ? Math.round((usedDisk / totalDisk) * 10000) / 100 : 0, labels: { mount: "/" }, ts: now });
    }
  } catch {}

  // Network I/O (Linux only — reads /proc/net/dev)
  try {
    const netDev = execSync("cat /proc/net/dev 2>/dev/null", { encoding: "utf8", timeout: 2000 });
    const lines = netDev.trim().split("\n").slice(2); // Skip headers
    let rxTotal = 0, txTotal = 0;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const iface = parts[0].replace(":", "");
      if (iface === "lo") continue; // skip loopback
      rxTotal += parseInt(parts[1], 10) || 0;
      txTotal += parseInt(parts[9], 10) || 0;
    }
    points.push({ host: hostname, name: "network_rx_bytes_total", value: rxTotal, ts: now });
    points.push({ host: hostname, name: "network_tx_bytes_total", value: txTotal, ts: now });

    // Calculate rate if we have previous reading
    if (prevNetStats) {
      const elapsed = (now - prevNetStats.ts) / 1000;
      if (elapsed > 0) {
        points.push({ host: hostname, name: "network_rx_bytes_per_sec", value: Math.round((rxTotal - prevNetStats.rx) / elapsed), ts: now });
        points.push({ host: hostname, name: "network_tx_bytes_per_sec", value: Math.round((txTotal - prevNetStats.tx) / elapsed), ts: now });
      }
    }
    prevNetStats = { rx: rxTotal, tx: txTotal, ts: now };
  } catch {}

  // Process count (Linux/macOS)
  try {
    const psOutput = execSync("ps aux 2>/dev/null | wc -l", { encoding: "utf8", timeout: 3000 });
    const processCount = parseInt(psOutput.trim(), 10) - 1; // minus header
    points.push({ host: hostname, name: "process_count", value: processCount, ts: now });
  } catch {}

  return points;
}
