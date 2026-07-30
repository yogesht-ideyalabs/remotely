import { useEffect, useState } from "react";
import {
  fetchJoinTokens,
  createJoinTokenApi,
  revokeJoinTokenApi,
  fetchAgentDownloadInfo,
  downloadAgentArchive,
  type JoinTokenItem,
  type AgentDownloadInfo,
} from "../api";
import { FieldLabel } from "../components/FieldLabel";
import { Skeleton } from "../components/Skeleton";

export default function InstallAgent() {
  const [tokens, setTokens] = useState<JoinTokenItem[] | null>(null);
  const [downloadInfo, setDownloadInfo] = useState<AgentDownloadInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", maxUses: 1, ttlMinutes: 60 });
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<JoinTokenItem | null>(null);
  const [downloading, setDownloading] = useState<"linux" | "windows" | null>(null);

  function load() {
    fetchJoinTokens().then(setTokens).catch((e) => setError(e.message));
    fetchAgentDownloadInfo()
      .then(setDownloadInfo)
      .catch(() => setDownloadInfo({ linux: false, windows: false }));
  }
  useEffect(load, []);

  async function createToken(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const token = await createJoinTokenApi(form.label || "agent", form.maxUses, form.ttlMinutes);
      setJustCreated(token);
      setForm({ label: "", maxUses: 1, ttlMinutes: 60 });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(token: string) {
    if (!confirm("Revoke this join token? Any install that hasn't used it yet will fail to register.")) return;
    try {
      await revokeJoinTokenApi(token);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "revoke failed");
    }
  }

  async function download(platform: "linux" | "windows") {
    setError(null);
    setDownloading(platform);
    try {
      await downloadAgentArchive(platform);
    } catch (err) {
      setError(err instanceof Error ? err.message : "download failed");
    } finally {
      setDownloading(null);
    }
  }

  const controlPlaneWsUrl = `ws://${window.location.hostname}:4000`;
  const activeToken = justCreated ?? tokens?.find((t) => !t.revoked && t.uses < t.maxUses && t.expiresAt > Date.now());
  const tokenPlaceholder = activeToken?.token ?? "YOUR-JOIN-TOKEN";

  return (
    <div>
      <h2 className="page-title">Install Agent</h2>
      <p className="page-sub">
        Agents dial out to the control plane over an outbound WebSocket — no inbound port needs to be open on the
        target host. Three steps: generate a join token, download the compiled binary, run the installer.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>1. Join token</h3>
        <p className="hint">
          A single-use (by default) bootstrap credential the agent presents once to register itself — not a
          standing secret it holds long-term. Generate one per install, or a multi-use one for a batch of hosts.
        </p>

        {justCreated && (
          <div className="section-card" style={{ background: "var(--bg)" }}>
            <div className="hint" style={{ marginTop: 0 }}>
              New token (shown once — expires in {form.ttlMinutes || 60} minutes):
            </div>
            <code style={{ fontSize: 13, wordBreak: "break-all" }}>{justCreated.token}</code>
            <div>
              <button className="link" onClick={() => setJustCreated(null)}>
                dismiss
              </button>
            </div>
          </div>
        )}

        <form onSubmit={createToken} className="form-row" style={{ alignItems: "flex-end" }}>
          <div>
            <FieldLabel label="Label">Just for your own reference in the list below.</FieldLabel>
            <input placeholder="e.g. prod-web-01" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </div>
          <div>
            <FieldLabel label="Max uses">1 for a single host, higher to bootstrap several with the same token.</FieldLabel>
            <input type="number" min={1} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: Number(e.target.value) })} style={{ width: 90 }} />
          </div>
          <div>
            <FieldLabel label="Expires in (minutes)">Unused after this, the token stops working.</FieldLabel>
            <input type="number" min={1} value={form.ttlMinutes} onChange={(e) => setForm({ ...form, ttlMinutes: Number(e.target.value) })} style={{ width: 90 }} />
          </div>
          <button className="primary" style={{ width: "auto", padding: "8px 20px" }} disabled={creating}>
            {creating ? "Generating..." : "Generate token"}
          </button>
        </form>

        {!tokens && <Skeleton lines={2} />}
        {tokens && tokens.length > 0 && (
          <div className="admin-table-wrap" style={{ marginTop: 12 }}>
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Uses</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => {
                  const expired = t.expiresAt <= Date.now();
                  const exhausted = t.uses >= t.maxUses;
                  const status = t.revoked ? "revoked" : expired ? "expired" : exhausted ? "used up" : "active";
                  return (
                    <tr key={t.token}>
                      <td>{t.label}</td>
                      <td>
                        {t.uses}/{t.maxUses}
                      </td>
                      <td>{new Date(t.expiresAt).toLocaleString()}</td>
                      <td style={{ color: status === "active" ? "var(--ok)" : "var(--text-dim)", fontSize: 12 }}>{status}</td>
                      <td>
                        {!t.revoked && (
                          <button className="danger-link" onClick={() => revoke(t.token)}>
                            revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>2. Download the agent</h3>
        <p className="hint">
          Real compiled binaries built from this control plane's own <code>agent/</code> source (Node single-file
          executables — no runtime install needed on the target). If a platform shows as unavailable, it hasn't
          been built on this server yet: run <code>agent/scripts/build-binary.sh</code> (Linux) or{" "}
          <code>agent/scripts/build-windows.sh</code> (Windows) first.
        </p>
        {!downloadInfo && <Skeleton lines={1} />}
        {downloadInfo && (
          <div className="form-row">
            <button className="secondary" disabled={!downloadInfo.linux || downloading === "linux"} onClick={() => download("linux")}>
              {downloading === "linux" ? "Downloading..." : downloadInfo.linux ? "Download for Linux (x64)" : "Linux binary not built"}
            </button>
            <button className="secondary" disabled={!downloadInfo.windows || downloading === "windows"} onClick={() => download("windows")}>
              {downloading === "windows" ? "Downloading..." : downloadInfo.windows ? "Download for Windows (x64)" : "Windows binary not built"}
            </button>
          </div>
        )}
      </div>

      <div className="section-card">
        <h3 style={{ marginTop: 0 }}>3. Install &amp; run</h3>
        <p className="hint">
          Substitute your real join token below (the one generated above, if still active) — swap{" "}
          <code>{controlPlaneWsUrl}</code> for this control plane's actual reachable address if the target host
          isn't on the same network.
        </p>

        <b style={{ fontSize: 13 }}>Linux (systemd service)</b>
        <pre style={{ background: "var(--bg)", padding: 12, borderRadius: 8, fontSize: 12, overflowX: "auto" }}>
{`tar xzf remotely-agent-linux-x64.tar.gz
sudo ./scripts/install-linux.sh \\
  --url ${controlPlaneWsUrl} \\
  --token ${tokenPlaceholder}`}
        </pre>
        <p className="hint" style={{ marginTop: -8 }}>
          Installs to <code>/opt/remotely-agent</code>, registers a <code>remotely-agent</code> systemd service, and
          starts it. Check status with <code>systemctl status remotely-agent</code>.
        </p>

        <b style={{ fontSize: 13 }}>Windows (PowerShell, as Administrator)</b>
        <pre style={{ background: "var(--bg)", padding: 12, borderRadius: 8, fontSize: 12, overflowX: "auto" }}>
{`tar xzf remotely-agent-windows-x64.tar.gz
cd dist-windows-x64
.\\install-agent.ps1 -ControlPlaneUrl "${controlPlaneWsUrl}" -JoinToken "${tokenPlaceholder}"`}
        </pre>
        <p className="hint" style={{ marginTop: -8 }}>
          Installs to <code>C:\Program Files\Remotely\Agent</code> and registers a <code>RemotelyAgent</code> Windows
          service.
        </p>

        <p className="hint">
          Once it connects, the host shows up on the <a href="/admin/agents">Agent Health</a> page within a few
          seconds.
        </p>
      </div>
    </div>
  );
}
