/**
 * Uptime monitors — Uptime Kuma-style HTTP/TCP/keyword/agent-heartbeat
 * checks, plus the SMTP settings that drive their alert emails.
 *
 * Author: Yogesh Tiwari
 */

import { useEffect, useState } from "react";
import {
  fetchMonitors,
  createMonitor,
  updateMonitor,
  deleteMonitor,
  testMonitor,
  fetchMonitorChecks,
  fetchAgents,
  fetchSmtpConfig,
  saveSmtpConfig,
  testSmtpConfig,
  type MonitorView,
  type MonitorInput,
  type MonitorType,
  type MonitorCheckView,
  type AgentHealthInfo,
  type SmtpConfigView,
  type SiemDeliveryResult,
} from "../api";
import { FieldLabel } from "../components/FieldLabel";

const TYPE_LABELS: Record<MonitorType, string> = { http: "HTTP(s)", tcp: "TCP port", keyword: "Keyword", heartbeat: "Agent heartbeat" };

function emptyForm(): MonitorInput {
  return {
    name: "",
    type: "http",
    enabled: true,
    intervalSeconds: 60,
    timeoutMs: 10000,
    retries: 0,
    url: "",
    expectedStatusMin: 200,
    expectedStatusMax: 299,
    keyword: "",
    keywordShouldExist: true,
    host: "",
    port: undefined,
    agentId: "",
  };
}

function StatusPill({ status }: { status: MonitorView["status"] }) {
  if (status === "up") return <span className="label-chip" style={{ background: "rgba(62,207,142,0.15)", color: "var(--ok)" }}>🟢 Up</span>;
  if (status === "down") return <span className="label-chip" style={{ background: "rgba(255,91,110,0.15)", color: "var(--danger)" }}>🔴 Down</span>;
  return <span className="label-chip">⚪ Pending</span>;
}

function MonitorForm({ initial, agents, onSave, onCancel }: { initial: MonitorInput; agents: AgentHealthInfo[]; onSave: (data: MonitorInput) => Promise<void>; onCancel: () => void }) {
  const [form, setForm] = useState<MonitorInput>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="section-card" onSubmit={submit} style={{ maxWidth: 560 }}>
      {error && <div className="error-banner">{error}</div>}
      <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <FieldLabel label="Name">A short label for this monitor — shown on the list and in alert emails.</FieldLabel>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Production website" />
      </div>

      <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch", marginTop: 10 }}>
        <FieldLabel label="Monitor type">
          HTTP(s) checks a URL's status code. Keyword also verifies specific text appears (or doesn't) in the
          response. TCP port opens a raw socket — use for databases, SSH, anything non-HTTP. Agent heartbeat reuses
          this app's own agent connectivity data — no new probing.
        </FieldLabel>
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as MonitorType })}>
          {(Object.keys(TYPE_LABELS) as MonitorType[]).map((t) => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>

      {(form.type === "http" || form.type === "keyword") && (
        <>
          <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch", marginTop: 10 }}>
            <FieldLabel label="URL">The full URL to request, including https:// — redirects are followed automatically.</FieldLabel>
            <input value={form.url ?? ""} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/health" />
          </div>
          <div className="form-row" style={{ gap: 10, marginTop: 10 }}>
            <div style={{ flex: 1 }}>
              <FieldLabel label="Expected status min">Lowest HTTP status code considered "up" — 200 for a typical health check.</FieldLabel>
              <input type="number" value={form.expectedStatusMin ?? 200} onChange={(e) => setForm({ ...form, expectedStatusMin: Number(e.target.value) })} />
            </div>
            <div style={{ flex: 1 }}>
              <FieldLabel label="Expected status max">Highest HTTP status code considered "up" — 299 covers all 2xx success codes.</FieldLabel>
              <input type="number" value={form.expectedStatusMax ?? 299} onChange={(e) => setForm({ ...form, expectedStatusMax: Number(e.target.value) })} />
            </div>
          </div>
        </>
      )}

      {form.type === "keyword" && (
        <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch", marginTop: 10 }}>
          <FieldLabel label="Keyword">Plain text to search for in the response body.</FieldLabel>
          <input value={form.keyword ?? ""} onChange={(e) => setForm({ ...form, keyword: e.target.value })} placeholder='e.g. "status":"ok"' />
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <input type="checkbox" checked={form.keywordShouldExist ?? true} onChange={(e) => setForm({ ...form, keywordShouldExist: e.target.checked })} />
            Keyword must be present (uncheck to alert if it IS found — e.g. detecting an error page)
          </label>
        </div>
      )}

      {form.type === "tcp" && (
        <div className="form-row" style={{ gap: 10, marginTop: 10 }}>
          <div style={{ flex: 2 }}>
            <FieldLabel label="Host">Hostname or IP address to connect to.</FieldLabel>
            <input value={form.host ?? ""} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="db.internal" />
          </div>
          <div style={{ flex: 1 }}>
            <FieldLabel label="Port">TCP port to connect to.</FieldLabel>
            <input type="number" value={form.port ?? ""} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} placeholder="5432" />
          </div>
        </div>
      )}

      {form.type === "heartbeat" && (
        <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch", marginTop: 10 }}>
          <FieldLabel label="Agent">Which connected agent to watch — alerts if it disconnects or stops heartbeating.</FieldLabel>
          <select value={form.agentId ?? ""} onChange={(e) => setForm({ ...form, agentId: e.target.value })}>
            <option value="">Select an agent...</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.hostname}</option>
            ))}
          </select>
        </div>
      )}

      <div className="form-row" style={{ gap: 10, marginTop: 10 }}>
        <div style={{ flex: 1 }}>
          <FieldLabel label="Check interval (seconds)">How often to run this check. Minimum 15s.</FieldLabel>
          <input type="number" value={form.intervalSeconds} onChange={(e) => setForm({ ...form, intervalSeconds: Number(e.target.value) })} />
        </div>
        <div style={{ flex: 1 }}>
          <FieldLabel label="Timeout (ms)">How long to wait for a response before treating it as a failure.</FieldLabel>
          <input type="number" value={form.timeoutMs} onChange={(e) => setForm({ ...form, timeoutMs: Number(e.target.value) })} />
        </div>
        <div style={{ flex: 1 }}>
          <FieldLabel label="Retries before alert">Consecutive failures tolerated before marking down and alerting — 0 alerts immediately.</FieldLabel>
          <input type="number" value={form.retries} onChange={(e) => setForm({ ...form, retries: Number(e.target.value) })} />
        </div>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
        Enabled
      </label>

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button className="primary" style={{ width: "auto" }} disabled={saving}>{saving ? "Saving..." : "Save monitor"}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function MonitorHistory({ monitorId }: { monitorId: string }) {
  const [checks, setChecks] = useState<MonitorCheckView[] | null>(null);
  useEffect(() => {
    fetchMonitorChecks(monitorId).then((c) => setChecks(c.slice().reverse().slice(0, 30)));
  }, [monitorId]);
  if (!checks) return <p className="hint">Loading history...</p>;
  if (checks.length === 0) return <p className="hint">No checks recorded yet.</p>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
      {checks.slice().reverse().map((c) => (
        <span
          key={c.id}
          title={`${new Date(c.ts).toLocaleString()} — ${c.message}${c.responseTimeMs ? ` (${c.responseTimeMs}ms)` : ""}`}
          style={{
            width: 10,
            height: 20,
            borderRadius: 2,
            background: c.status === "up" ? "var(--ok)" : "var(--danger)",
            opacity: 0.85,
            cursor: "help",
          }}
        />
      ))}
    </div>
  );
}

export default function Monitors() {
  const [monitors, setMonitors] = useState<MonitorView[]>([]);
  const [agents, setAgents] = useState<AgentHealthInfo[]>([]);
  const [showForm, setShowForm] = useState<{ mode: "create" } | { mode: "edit"; monitor: MonitorView } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  function load() {
    fetchMonitors().then(setMonitors).catch((e) => setError(e.message));
    fetchAgents().then(setAgents).catch(() => {});
  }
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  async function handleSave(data: MonitorInput) {
    if (showForm?.mode === "edit") {
      await updateMonitor(showForm.monitor.id, data);
    } else {
      await createMonitor(data);
    }
    setShowForm(null);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this monitor? This cannot be undone.")) return;
    await deleteMonitor(id);
    load();
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      await testMonitor(id);
      load();
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div>
      <h2 className="page-title">Uptime Monitors</h2>
      <p className="page-sub">
        HTTP, TCP, keyword, and agent-heartbeat checks on a schedule — status changes are logged, notified in-app,
        and (if SMTP alert email is configured below) emailed.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div style={{ marginBottom: 14 }}>
        <button className="primary" style={{ width: "auto" }} onClick={() => setShowForm({ mode: "create" })}>+ Add monitor</button>
      </div>

      {showForm && (
        <MonitorForm
          initial={showForm.mode === "edit" ? showForm.monitor : emptyForm()}
          agents={agents}
          onSave={handleSave}
          onCancel={() => setShowForm(null)}
        />
      )}

      {monitors.length === 0 ? (
        <div className="empty-state">No monitors configured yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {monitors.map((m) => (
            <div key={m.id} className="section-card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <StatusPill status={m.status} />
                  <b>{m.name}</b>
                  <span className="label-chip">{TYPE_LABELS[m.type]}</span>
                  {!m.enabled && <span className="label-chip">disabled</span>}
                </div>
                <div className="row-actions">
                  <button className="btn-sm" onClick={() => handleTest(m.id)} disabled={testingId === m.id}>
                    {testingId === m.id ? "Testing..." : "Test now"}
                  </button>
                  <button className="btn-sm" onClick={() => setExpanded(expanded === m.id ? null : m.id)}>
                    {expanded === m.id ? "Hide history" : "History"}
                  </button>
                  <button className="btn-sm" onClick={() => setShowForm({ mode: "edit", monitor: m })}>Edit</button>
                  <button className="btn-sm danger-link" onClick={() => handleDelete(m.id)}>Delete</button>
                </div>
              </div>
              <div className="hint" style={{ marginTop: 8 }}>
                {m.type === "http" || m.type === "keyword" ? m.url : m.type === "tcp" ? `${m.host}:${m.port}` : agents.find((a) => a.id === m.agentId)?.hostname ?? m.agentId}
                {" · "}every {m.intervalSeconds}s
                {m.lastCheckedAt && ` · last checked ${new Date(m.lastCheckedAt).toLocaleTimeString()}`}
                {m.lastResponseTimeMs != null && ` · ${m.lastResponseTimeMs}ms`}
                {m.uptime24h != null && ` · ${m.uptime24h}% up (24h)`}
              </div>
              {m.status === "down" && m.lastError && (
                <div className="error-banner" style={{ marginTop: 8 }}>{m.lastError}</div>
              )}
              {expanded === m.id && <MonitorHistory monitorId={m.id} />}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <SmtpSettings />
      </div>
    </div>
  );
}

function SmtpSettings() {
  const [config, setConfig] = useState<SmtpConfigView | null>(null);
  const [form, setForm] = useState({ enabled: false, host: "", port: 587, secure: false, username: "", password: "", fromAddress: "", toAddresses: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SiemDeliveryResult | null>(null);

  useEffect(() => {
    fetchSmtpConfig()
      .then((c) => {
        setConfig(c);
        setForm({ enabled: c.enabled, host: c.host, port: c.port, secure: c.secure, username: c.username, password: "", fromAddress: c.fromAddress, toAddresses: c.toAddresses.join(", ") });
      })
      .catch((e) => setError(e.message));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const saved = await saveSmtpConfig({
        enabled: form.enabled,
        host: form.host,
        port: form.port,
        secure: form.secure,
        username: form.username,
        password: form.password || undefined,
        fromAddress: form.fromAddress,
        toAddresses: form.toAddresses.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setConfig(saved);
      setForm((f) => ({ ...f, password: "" }));
      setTestResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testSmtpConfig());
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : "test failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <h2 className="page-title" style={{ fontSize: 18 }}>Alert Email (SMTP)</h2>
      <p className="page-sub">Where monitor up/down alert emails get sent from and to.</p>
      {error && <div className="error-banner">{error}</div>}
      <form className="section-card" onSubmit={save} style={{ maxWidth: 560 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          Enable alert emails
        </label>

        <div className="form-row" style={{ gap: 10 }}>
          <div style={{ flex: 3 }}>
            <FieldLabel label="SMTP host">Your mail server's hostname — e.g. smtp.gmail.com, or your testing SMTP server's address.</FieldLabel>
            <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="smtp.example.com" />
          </div>
          <div style={{ flex: 1 }}>
            <FieldLabel label="Port">587 (STARTTLS) or 465 (implicit TLS) are the usual choices.</FieldLabel>
            <input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <input type="checkbox" checked={form.secure} onChange={(e) => setForm({ ...form, secure: e.target.checked })} />
          Use implicit TLS (check this for port 465, leave unchecked for 587/25)
        </label>

        <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch", marginTop: 10 }}>
          <FieldLabel label="Username">Your SMTP account's login — often the same as the from-address.</FieldLabel>
          <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="alerts@example.com" />
        </div>

        <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch", marginTop: 10 }}>
          <FieldLabel label="Password">
            {config?.passwordSet && "Currently set — leave blank to keep it. "}Your SMTP account's password or app-specific
            password (Gmail/Outlook both require an app password, not your normal login password).
          </FieldLabel>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={config?.passwordSet ? "•••••••• (unchanged)" : "password"}
          />
        </div>

        <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch", marginTop: 10 }}>
          <FieldLabel label="From address">The sender address recipients will see — falls back to Username if left blank.</FieldLabel>
          <input value={form.fromAddress} onChange={(e) => setForm({ ...form, fromAddress: e.target.value })} placeholder="alerts@example.com" />
        </div>

        <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch", marginTop: 10 }}>
          <FieldLabel label="Alert recipients">Comma-separated email addresses that receive monitor up/down alerts.</FieldLabel>
          <input value={form.toAddresses} onChange={(e) => setForm({ ...form, toAddresses: e.target.value })} placeholder="you@example.com, oncall@example.com" />
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
          <button className="primary" style={{ width: "auto" }} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
          <button type="button" className="secondary" onClick={runTest} disabled={testing || !config?.host}>
            {testing ? "Sending..." : "Send test email"}
          </button>
        </div>
        {testResult && (
          <div className={testResult.ok ? "hint" : "error-banner"} style={{ marginTop: 10 }}>
            {testResult.ok ? "Test email sent — check your inbox." : `Failed: ${testResult.error}`}
          </div>
        )}
        {config?.updatedAt && (
          <div className="hint" style={{ marginTop: 10 }}>
            Last updated {new Date(config.updatedAt).toLocaleString()} by {config.updatedBy}
          </div>
        )}
      </form>
    </>
  );
}
