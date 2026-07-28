import { useEffect, useState } from "react";
import { fetchSiemConfig, saveSiemConfig, testSiemConfig, type SiemConfigView, type SiemDeliveryResult } from "../api";
import { FieldLabel } from "../components/FieldLabel";

export default function SiemExport() {
  const [config, setConfig] = useState<SiemConfigView | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SiemDeliveryResult | null>(null);

  function load() {
    fetchSiemConfig()
      .then((c) => {
        setConfig(c);
        setEnabled(c.enabled);
        setWebhookUrl(c.webhookUrl);
      })
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const saved = await saveSiemConfig({ enabled, webhookUrl, secret: secret || undefined });
      setConfig(saved);
      setSecret("");
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
    setError(null);
    try {
      setTestResult(await testSiemConfig());
    } catch (err) {
      setError(err instanceof Error ? err.message : "test failed");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      <h2 className="page-title">SIEM Export</h2>
      <p className="page-sub">
        Forward every audit event to an external webhook in real time — the same integration point Splunk's HTTP
        Event Collector, Datadog Logs intake, or a generic log-shipper front-end all expect. Deliveries are signed
        with HMAC-SHA256 (like GitHub/Stripe webhooks) so the receiver can verify they actually came from here.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <form className="section-card" onSubmit={save} style={{ maxWidth: 560 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enable real-time export
        </label>

        <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
          <FieldLabel label="Webhook URL">
            Your SIEM's HTTP event-intake endpoint — e.g. Splunk's HTTP Event Collector URL, Datadog Logs intake, or
            any generic log-shipper's ingest URL. Get this from your SIEM's own integration/API settings page.
          </FieldLabel>
          <input
            type="url"
            placeholder="https://your-siem.example.com/collector"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
        </div>

        <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch", marginTop: 10 }}>
          <FieldLabel label="Signing secret">
            A shared secret used to HMAC-SHA256-sign every delivery, the same pattern GitHub/Stripe webhooks use — so
            your receiver can verify events actually came from here. Generate any long random string; configure the
            identical value on the SIEM side to verify signatures.
            {config?.secretSet && <> Currently set: <b>{config.secretPreview}</b> — leave blank to keep it.</>}
          </FieldLabel>
          <input
            type="password"
            placeholder={config?.secretSet ? "•••••••• (unchanged)" : "a long random shared secret"}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </div>

        <button className="primary" style={{ width: "auto", marginTop: 14 }} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>

        {config?.updatedAt && (
          <div className="hint" style={{ marginTop: 10 }}>
            Last updated {new Date(config.updatedAt).toLocaleString()} by {config.updatedBy}
          </div>
        )}
      </form>

      <div className="section-card" style={{ maxWidth: 560 }}>
        <b style={{ fontSize: 13 }}>Test delivery</b>
        <p className="hint">Sends one signed test event to the saved webhook URL right now, independent of whether export is enabled.</p>
        <button className="secondary" onClick={runTest} disabled={testing || !config?.webhookUrl}>
          {testing ? "Sending..." : "Send test event"}
        </button>
        {testResult && (
          <div className={testResult.ok ? "hint" : "error-banner"} style={{ marginTop: 10 }}>
            {testResult.ok ? `Delivered — HTTP ${testResult.status}` : `Failed: ${testResult.error ?? testResult.status}`}
          </div>
        )}
      </div>
    </div>
  );
}
