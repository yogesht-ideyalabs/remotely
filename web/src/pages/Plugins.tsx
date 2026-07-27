import { useEffect, useState } from "react";
import { fetchPlugins, createPlugin, updatePlugin, deletePlugin, testPlugin, type WebhookPluginView } from "../api";
import { AUDIT_CATEGORIES } from "../auditCategories";
import { FieldLabel } from "../components/FieldLabel";

const emptyForm = { name: "", enabled: false, eventTypes: [] as string[], webhookUrl: "", secret: "" };

export default function Plugins() {
  const [plugins, setPlugins] = useState<WebhookPluginView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // plugin id, or "" for new
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  function load() {
    fetchPlugins().then(setPlugins).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  function startCreate() {
    setForm(emptyForm);
    setEditing("");
  }

  function startEdit(p: WebhookPluginView) {
    setForm({ name: p.name, enabled: p.enabled, eventTypes: p.eventTypes, webhookUrl: p.webhookUrl, secret: "" });
    setEditing(p.id);
  }

  function toggleEventType(eventType: string) {
    setForm((f) => ({
      ...f,
      eventTypes: f.eventTypes.includes(eventType) ? f.eventTypes.filter((t) => t !== eventType) : [...f.eventTypes, eventType],
    }));
  }

  function toggleCategory(categoryEventTypes: string[]) {
    const allSelected = categoryEventTypes.every((t) => form.eventTypes.includes(t));
    setForm((f) => ({
      ...f,
      eventTypes: allSelected
        ? f.eventTypes.filter((t) => !categoryEventTypes.includes(t))
        : Array.from(new Set([...f.eventTypes, ...categoryEventTypes])),
    }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = { name: form.name, enabled: form.enabled, eventTypes: form.eventTypes, webhookUrl: form.webhookUrl, secret: form.secret || undefined };
      if (editing === "") await createPlugin(payload);
      else if (editing) await updatePlugin(editing, payload);
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: WebhookPluginView) {
    if (!confirm(`Delete plugin "${p.name}"?`)) return;
    try {
      await deletePlugin(p.id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  async function runTest(p: WebhookPluginView) {
    setTestResults((r) => ({ ...r, [p.id]: "Sending..." }));
    try {
      const result = await testPlugin(p.id);
      setTestResults((r) => ({ ...r, [p.id]: result.ok ? `Delivered — HTTP ${result.status}` : `Failed: ${result.error ?? result.status}` }));
    } catch (err) {
      setTestResults((r) => ({ ...r, [p.id]: err instanceof Error ? err.message : "test failed" }));
    }
  }

  return (
    <div>
      <h2 className="page-title">Plugins</h2>
      <p className="page-sub">
        Independent, event-filtered webhook targets — unlike SIEM Export (one global stream of everything), each
        plugin only fires for the event types you pick, like a Slack or PagerDuty integration that only pings you
        for what you actually care about. Deliveries are HMAC-signed the same way SIEM Export's are.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {editing !== null && (
        <form className="section-card" onSubmit={save}>
          <h3>{editing === "" ? "New plugin" : "Edit plugin"}</h3>
          <div className="form-row">
            <div style={{ minWidth: 280 }}>
              <FieldLabel label="Plugin name">
                Just a label for this target on the list below — e.g. <b>Slack — access requests</b>. No effect on
                delivery.
              </FieldLabel>
              <input placeholder="plugin name, e.g. Slack — access requests" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ minWidth: 280 }} />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} style={{ width: "auto", margin: 0 }} />
              Enabled
            </label>
          </div>
          <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <FieldLabel label="Webhook URL">
              Where events get POSTed — for Slack, an Incoming Webhook URL from your workspace's App settings
              (hooks.slack.com/services/...); for PagerDuty, an Events API v2 integration URL; for a custom
              receiver, any HTTPS endpoint that accepts a signed JSON POST.
            </FieldLabel>
            <input type="url" placeholder="https://hooks.slack.com/services/..." value={form.webhookUrl} onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} />
          </div>
          <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <FieldLabel label="Signing secret">
              Used to HMAC-SHA256-sign every delivery so your receiver can verify it actually came from here.
              Generate any long random string yourself — this isn't something you get from Slack/PagerDuty, it's a
              secret you invent and configure identically on your receiver's verification side. Leave blank when
              editing to keep the existing one.
            </FieldLabel>
            <input type="password" placeholder="a long random shared secret" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
          </div>
          <div className="form-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div className="hint">
              Event types ({form.eventTypes.length === 0 ? "all events" : `${form.eventTypes.length} selected`}) — leave everything unchecked to fire on every event
            </div>
            <div className="plugin-event-picker">
              {AUDIT_CATEGORIES.map((cat) => {
                const allSelected = cat.eventTypes.every((t) => form.eventTypes.includes(t));
                return (
                  <div key={cat.id} className="plugin-event-category">
                    <label className="plugin-event-category-header">
                      <input type="checkbox" checked={allSelected} onChange={() => toggleCategory(cat.eventTypes)} style={{ width: "auto", margin: 0 }} />
                      <b>{cat.label}</b>
                    </label>
                    <div className="plugin-event-list">
                      {cat.eventTypes.map((t) => (
                        <label key={t} className="plugin-event-item" title={t}>
                          <input type="checkbox" checked={form.eventTypes.includes(t)} onChange={() => toggleEventType(t)} style={{ width: "auto", margin: 0, flexShrink: 0, marginTop: 1 }} />
                          <span>{t}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="form-row">
            <button className="primary" style={{ width: "auto", padding: "8px 20px" }} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {editing === null && (
        <button className="secondary" style={{ marginBottom: 16 }} onClick={startCreate}>
          + New plugin
        </button>
      )}

      {plugins && plugins.length === 0 && <div className="empty-state">No plugins configured yet.</div>}
      {plugins && plugins.length > 0 && (
        <table className="audit-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Event types</th>
              <th>Webhook</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {plugins.map((p) => (
              <tr key={p.id}>
                <td>
                  <b>{p.name}</b>
                </td>
                <td>
                  <span style={{ color: p.enabled ? "var(--ok)" : "var(--text-dim)", fontSize: 12 }}>{p.enabled ? "● enabled" : "○ disabled"}</span>
                </td>
                <td>{p.eventTypes.length === 0 ? "all events" : `${p.eventTypes.length} selected`}</td>
                <td style={{ fontSize: 11, color: "var(--text-dim)" }}>{p.webhookUrl}</td>
                <td>
                  <button className="link" onClick={() => startEdit(p)}>
                    edit
                  </button>
                  <button className="link" onClick={() => runTest(p)}>
                    test
                  </button>
                  <button className="danger-link" onClick={() => remove(p)}>
                    delete
                  </button>
                  {testResults[p.id] && (
                    <div className="hint" style={{ marginTop: 4 }}>
                      {testResults[p.id]}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
