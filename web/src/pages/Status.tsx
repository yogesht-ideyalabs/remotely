import { useEffect, useState } from "react";

interface StatusInfo {
  status: string;
  version: string;
  nodeVersion: string;
  uptimeSeconds: number;
  connectedAgents: number;
  activeSessions: number;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

export default function Status() {
  const [info, setInfo] = useState<StatusInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function load() {
      fetch("/api/status")
        .then((r) => r.json())
        .then(setInfo)
        .catch(() => setError("Could not reach the control plane."));
    }
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ maxWidth: 640, margin: "60px auto", padding: "0 20px" }}>
      <h2 className="page-title">Control Plane Status</h2>
      <p className="page-sub">
        Public, unauthenticated — counts only, no tenant data. Useful for a load balancer health check or just
        confirming the control plane itself is alive before troubleshooting anything else.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {!info && !error && <p className="hint">Checking...</p>}
      {info && (
        <div className="section-card">
          <div className="form-row" style={{ marginBottom: 4 }}>
            <span className="dot" style={{ background: info.status === "ok" ? "var(--ok)" : "var(--danger)" }} />
            <b>{info.status === "ok" ? "Healthy" : "Unhealthy"}</b>
          </div>
          <table style={{ width: "100%", marginTop: 16 }}>
            <tbody>
              <tr>
                <td className="hint">Version</td>
                <td>{info.version}</td>
              </tr>
              <tr>
                <td className="hint">Node.js</td>
                <td>{info.nodeVersion}</td>
              </tr>
              <tr>
                <td className="hint">Uptime</td>
                <td>{formatUptime(info.uptimeSeconds)}</td>
              </tr>
              <tr>
                <td className="hint">Connected agents</td>
                <td>{info.connectedAgents}</td>
              </tr>
              <tr>
                <td className="hint">Active sessions</td>
                <td>{info.activeSessions}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
