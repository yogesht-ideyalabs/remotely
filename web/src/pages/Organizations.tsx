import { Fragment, useEffect, useRef, useState } from "react";
import {
  fetchOrganizations,
  createOrganizationApi,
  updateOrganizationApi,
  deleteOrganizationApi,
  fetchOrgUsage,
  ApiError,
  type Organization,
  type OrgUsage,
} from "../api";

const BRAND_COLORS = ["#5b8cff", "#a26bff", "#22c07d", "#e0a325", "#ef4444", "#14b8a6", "#ec4899", "#6366f1"];

export default function Organizations() {
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ id: "", name: "" });
  const [expanded, setExpanded] = useState<string | null>(null);

  function load() {
    fetchOrganizations().then(setOrgs).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createOrganizationApi(form.id, form.name);
      setForm({ id: "", name: "" });
      setCreating(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    }
  }

  async function remove(id: string) {
    if (!confirm(`Delete organization "${id}"?`)) return;
    try {
      await deleteOrganizationApi(id);
      load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const users = (err.body.affectedUsers as string[]) ?? [];
        const conns = (err.body.affectedConnections as string[]) ?? [];
        const proceed = confirm(
          `Still referenced by ${users.length} user(s) [${users.join(", ")}] and ${conns.length} connection(s) [${conns.join(
            ", "
          )}].\n\nDelete anyway? They'll keep the org id as a dangling reference — they won't be deleted themselves.`
        );
        if (proceed) {
          try {
            await deleteOrganizationApi(id, true);
            load();
            return;
          } catch (err2) {
            setError(err2 instanceof Error ? err2.message : "delete failed");
            return;
          }
        }
        return;
      }
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  return (
    <div>
      <h2 className="page-title">Organizations</h2>
      <p className="page-sub">
        This is the top-level structure everything else hangs off — users and connections are tagged with an
        organization, roles scope delegated admins to one, and RBAC labels commonly key off it (<code>client</code>
        ). Expand a row to set white-label branding or see usage & SLA metrics.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {creating && (
        <form className="section-card" onSubmit={create}>
          <h3>New organization</h3>
          <div className="form-row">
            <input
              placeholder="id, e.g. acme-corp (used as the client label value)"
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
            />
            <input placeholder="display name, e.g. Acme Corp" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-row">
            <button className="primary" style={{ width: "auto", padding: "8px 20px" }}>
              Create
            </button>
            <button type="button" className="secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {!creating && (
        <button className="secondary" style={{ marginBottom: 16 }} onClick={() => setCreating(true)}>
          + New organization
        </button>
      )}

      {orgs && (
        <div className="admin-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Branding</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <Fragment key={o.id}>
                  <tr>
                    <td>
                      <code>{o.id}</code>
                    </td>
                    <td>{o.name}</td>
                    <td>
                      {o.brandColor && (
                        <span
                          style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: o.brandColor, marginRight: 6 }}
                        />
                      )}
                      {o.brandName || <span className="hint" style={{ margin: 0 }}>default</span>}
                    </td>
                    <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button className="link" onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                        {expanded === o.id ? "close" : "manage"}
                      </button>
                      <button className="danger-link" onClick={() => remove(o.id)}>
                        delete
                      </button>
                    </td>
                  </tr>
                  {expanded === o.id && (
                    <tr>
                      <td colSpan={5} style={{ padding: 0 }}>
                        <OrgDetail org={o} onChange={load} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OrgDetail({ org, onChange }: { org: Organization; onChange: () => void }) {
  const [brandName, setBrandName] = useState(org.brandName ?? "");
  const [brandColor, setBrandColor] = useState(org.brandColor ?? "");
  const [logoDataUri, setLogoDataUri] = useState<string | null>(org.logoDataUri ?? null);
  const [usage, setUsage] = useState<OrgUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchOrgUsage(org.id).then(setUsage).catch((e) => setError(e.message));
  }, [org.id]);

  function onLogoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_500_000) {
      setError("Logo too large — pick something under 1.5MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoDataUri(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateOrganizationApi(org.id, { brandName: brandName || null, brandColor: brandColor || null, logoDataUri });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "16px 20px", background: "var(--bg)", borderTop: "1px solid var(--panel-border)" }}>
      {error && <div className="error-banner">{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div>
          <h3 style={{ marginTop: 0 }}>White-label branding</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            Shown in the topbar instead of "Remotely" for this org's members.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <div
              className="avatar"
              style={{ width: 40, height: 40, background: brandColor || "var(--accent)" }}
            >
              {logoDataUri ? <img src={logoDataUri} alt="" /> : (brandName || org.name).slice(0, 1).toUpperCase()}
            </div>
            <button className="secondary" onClick={() => fileRef.current?.click()}>
              Upload logo
            </button>
            {logoDataUri && (
              <button className="danger-link" onClick={() => setLogoDataUri(null)}>
                Remove
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onLogoPicked} />
          </div>
          <input placeholder="brand name, e.g. Acme Portal" value={brandName} onChange={(e) => setBrandName(e.target.value)} />
          <div className="hint" style={{ marginTop: 0 }}>
            Brand color
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {BRAND_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setBrandColor(c)}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: c,
                  border: brandColor === c ? "2px solid var(--text)" : "2px solid transparent",
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            ))}
            <button className="link" onClick={() => setBrandColor("")}>
              clear
            </button>
          </div>
          <button className="primary" style={{ width: "auto", padding: "8px 20px" }} onClick={save} disabled={saving}>
            Save branding
          </button>
        </div>

        <div>
          <h3 style={{ marginTop: 0 }}>Usage & SLA</h3>
          {!usage && <div className="hint">Loading...</div>}
          {usage && (
            <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <div className="kpi-card">
                <div className="kpi-value">{usage.memberCount}</div>
                <div className="kpi-label">Members</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-value">{usage.resourceCount}</div>
                <div className="kpi-label">Resources</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-value">{usage.sessionsStarted}</div>
                <div className="kpi-label">Sessions (all time)</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-value">{usage.totalSessionMinutes}</div>
                <div className="kpi-label">Session-minutes billed</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-value" style={{ color: usage.errorRate > 0.1 ? "var(--danger)" : "var(--text)" }}>
                  {(100 - usage.errorRate * 100).toFixed(1)}%
                </div>
                <div className="kpi-label">Session success rate (SLA)</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-value">{usage.sessionErrors}</div>
                <div className="kpi-label">Session errors</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
