import { useEffect, useState, useCallback } from "react";
import mermaid from "mermaid";
import { apiFetch } from "../api";
import { FieldLabel } from "../components/FieldLabel";

let mermaidInitialized = false;
function ensureMermaidInitialized() {
  if (mermaidInitialized) return;
  mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose" });
  mermaidInitialized = true;
}

interface InfraAccount {
  id: string;
  name: string;
  provider: string;
  accountId: string;
  regions: string[];
  accessMode: string;
  agentIds: string[];
  enabled: boolean;
  lastSyncAt: number | null;
  createdAt: number;
}

interface InfraSummary {
  totalResources: number;
  byProvider: Record<string, number>;
  byType: Record<string, number>;
  byRegion: Record<string, number>;
  byAccount: { id: string; name: string; count: number }[];
  lastSyncAt: number | null;
}

interface GeneratedDiagram {
  format: string;
  diagramType: string;
  content: string;
  resourceCount: number;
  generatedAt: number;
}

type DiagramFormat = "mermaid" | "d2" | "json-graph";
type DiagramType = "architecture" | "network" | "both";
type GroupBy = "account" | "region" | "vpc" | "type";
type Scope = "all" | "account" | "region" | "vpc";

export default function InfraMap() {
  const [accounts, setAccounts] = useState<InfraAccount[]>([]);
  const [summary, setSummary] = useState<InfraSummary | null>(null);
  const [diagrams, setDiagrams] = useState<GeneratedDiagram[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Diagram generation options
  const [format, setFormat] = useState<DiagramFormat>("mermaid");
  const [diagramType, setDiagramType] = useState<DiagramType>("architecture");
  const [groupBy, setGroupBy] = useState<GroupBy>("account");
  const [scope, setScope] = useState<Scope>("all");
  const [scopeId, setScopeId] = useState("");

  // Add account form
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({
    name: "",
    provider: "aws",
    accountId: "",
    regions: "",
    accessMode: "agent",
    agentIds: "",
  });

  // Edit account form — same shape as newAccount plus `enabled`, keyed by
  // the account being edited so multiple cards can't open edit mode at once.
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [editAccount, setEditAccount] = useState({
    name: "",
    provider: "aws",
    accountId: "",
    regions: "",
    accessMode: "agent",
    agentIds: "",
    enabled: true,
  });

  const loadData = useCallback(async () => {
    try {
      const [accs, sum] = await Promise.all([
        apiFetch("/api/infra/accounts"),
        apiFetch("/api/infra/summary"),
      ]);
      setAccounts(accs);
      setSummary(sum);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const generateDiagram = async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await apiFetch("/api/infra/diagram", {
        method: "POST",
        body: JSON.stringify({
          format,
          scope,
          scopeId: scopeId || undefined,
          diagramType,
          groupBy,
        }),
      });
      setDiagrams(resp.diagrams || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const addAccount = async () => {
    try {
      await apiFetch("/api/infra/accounts", {
        method: "POST",
        body: JSON.stringify({
          ...newAccount,
          regions: newAccount.regions.split(",").map((r) => r.trim()).filter(Boolean),
          agentIds: newAccount.agentIds.split(",").map((r) => r.trim()).filter(Boolean),
        }),
      });
      setShowAddAccount(false);
      setNewAccount({ name: "", provider: "aws", accountId: "", regions: "", accessMode: "agent", agentIds: "" });
      loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const startEdit = (acc: InfraAccount) => {
    setEditingAccountId(acc.id);
    setEditAccount({
      name: acc.name,
      provider: acc.provider,
      accountId: acc.accountId,
      regions: acc.regions.join(", "),
      accessMode: acc.accessMode,
      agentIds: acc.agentIds.join(", "),
      enabled: acc.enabled,
    });
    setShowAddAccount(false);
  };

  const saveEdit = async () => {
    if (!editingAccountId) return;
    try {
      await apiFetch(`/api/infra/accounts/${editingAccountId}`, {
        method: "PUT",
        body: JSON.stringify({
          ...editAccount,
          regions: editAccount.regions.split(",").map((r) => r.trim()).filter(Boolean),
          agentIds: editAccount.agentIds.split(",").map((r) => r.trim()).filter(Boolean),
        }),
      });
      setEditingAccountId(null);
      loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const deleteAccount = async (id: string) => {
    if (!confirm("Delete this infrastructure account and all its discovered resources?")) return;
    try {
      await apiFetch(`/api/infra/accounts/${id}`, { method: "DELETE" });
      loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="page infra-map-page">
      <div className="page-header">
        <h1>🗺️ Infrastructure Map</h1>
        <p className="subtitle">
          Auto-discovered resources across all connected accounts and agents
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Summary Cards */}
      {summary && (
        <div className="infra-summary-grid">
          <div className="summary-card">
            <div className="card-value">{summary.totalResources}</div>
            <div className="card-label">Total Resources</div>
          </div>
          <div className="summary-card">
            <div className="card-value">{Object.keys(summary.byProvider).length}</div>
            <div className="card-label">Providers</div>
          </div>
          <div className="summary-card">
            <div className="card-value">{Object.keys(summary.byRegion).length}</div>
            <div className="card-label">Regions</div>
          </div>
          <div className="summary-card">
            <div className="card-value">{summary.byAccount.length}</div>
            <div className="card-label">Accounts</div>
          </div>
          {summary.lastSyncAt && (
            <div className="summary-card">
              <div className="card-value" style={{ fontSize: "0.9em" }}>
                {new Date(summary.lastSyncAt).toLocaleString()}
              </div>
              <div className="card-label">Last Sync</div>
            </div>
          )}
        </div>
      )}

      {/* Resource breakdown */}
      {summary && summary.totalResources > 0 && (
        <div className="infra-breakdown">
          <div className="breakdown-section">
            <h3>By Provider</h3>
            <div className="breakdown-items">
              {Object.entries(summary.byProvider).map(([provider, count]) => (
                <span key={provider} className="breakdown-chip">
                  {providerIcon(provider)} {provider}: {count}
                </span>
              ))}
            </div>
          </div>
          <div className="breakdown-section">
            <h3>By Type</h3>
            <div className="breakdown-items">
              {Object.entries(summary.byType)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([type, count]) => (
                  <span key={type} className="breakdown-chip">
                    {type}: {count}
                  </span>
                ))}
            </div>
          </div>
          <div className="breakdown-section">
            <h3>By Region</h3>
            <div className="breakdown-items">
              {Object.entries(summary.byRegion).map(([region, count]) => (
                <span key={region} className="breakdown-chip">
                  {region}: {count}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Diagram Generator */}
      <div className="infra-section">
        <h2>Generate Diagram</h2>
        <div className="diagram-controls">
          <label>
            Format:
            <select value={format} onChange={(e) => setFormat(e.target.value as DiagramFormat)}>
              <option value="mermaid">Mermaid (rendered in browser)</option>
              <option value="d2">D2 (copyable source)</option>
              <option value="json-graph">JSON Graph (for custom tools)</option>
            </select>
          </label>
          <label>
            Type:
            <select value={diagramType} onChange={(e) => setDiagramType(e.target.value as DiagramType)}>
              <option value="architecture">Architecture</option>
              <option value="network">Network Topology</option>
              <option value="both">Both</option>
            </select>
          </label>
          <label>
            Group By:
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
              <option value="account">Account</option>
              <option value="region">Region</option>
              <option value="vpc">VPC</option>
              <option value="type">Resource Type</option>
            </select>
          </label>
          <label>
            Scope:
            <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              <option value="all">All Resources</option>
              <option value="account">Specific Account</option>
              <option value="region">Specific Region</option>
              <option value="vpc">Specific VPC</option>
            </select>
          </label>
          {scope !== "all" && (
            <label>
              Scope ID:
              <input
                type="text"
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                placeholder={scope === "account" ? "Account ID" : scope === "region" ? "us-east-1" : "vpc-xxx"}
              />
            </label>
          )}
          <button className="btn-primary" onClick={generateDiagram} disabled={loading}>
            {loading ? "Generating..." : "Generate Diagram"}
          </button>
        </div>
      </div>

      {/* Rendered Diagrams */}
      {diagrams.length > 0 && (
        <div className="infra-section">
          <h2>Generated Diagrams</h2>
          {diagrams.map((d, i) => (
            <div key={i} className="diagram-output">
              <div className="diagram-header">
                <span className="diagram-badge">{d.diagramType}</span>
                <span className="diagram-meta">
                  {d.resourceCount} resources • {d.format} •{" "}
                  {new Date(d.generatedAt).toLocaleTimeString()}
                </span>
                <CopySourceButton content={d.content} />
                <button
                  className="btn-sm btn-danger"
                  onClick={() => setDiagrams((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  🗑 Remove
                </button>
              </div>
              {d.resourceCount === 0 ? (
                <p className="empty-state">
                  No resources match this scope/filter — add an infrastructure account and sync
                  resources first, or broaden the scope above.
                </p>
              ) : d.format === "mermaid" ? (
                <div className="mermaid-container">
                  <MermaidDiagram content={d.content} />
                </div>
              ) : (
                <pre className="diagram-source">{d.content}</pre>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Accounts Management */}
      <div className="infra-section">
        <div className="section-header">
          <h2>Infrastructure Accounts</h2>
          <button className="btn-primary" onClick={() => setShowAddAccount(!showAddAccount)}>
            + Add Account
          </button>
        </div>

        {showAddAccount && (
          <div className="add-account-form">
            <div>
              <FieldLabel label="Account name">
                A display name for this project/account — shown throughout the Architecture page and diagrams.
                Purely organizational, no effect on discovery.
              </FieldLabel>
              <input
                placeholder="Account Name (e.g., Production AWS)"
                value={newAccount.name}
                onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
              />
            </div>
            <div>
              <FieldLabel label="Provider">
                Which cloud/platform this account discovers resources from. Determines which sync method (direct API
                vs agent-based) and which resource types apply.
              </FieldLabel>
              <select
                value={newAccount.provider}
                onChange={(e) => setNewAccount({ ...newAccount, provider: e.target.value })}
              >
                <option value="aws">AWS</option>
                <option value="azure">Azure</option>
                <option value="gcp">GCP</option>
                <option value="vmware">VMware</option>
                <option value="proxmox">Proxmox</option>
                <option value="on-prem">On-Premise</option>
              </select>
            </div>
            <div>
              <FieldLabel label="Account / Subscription ID">
                The provider's own account identifier — your 12-digit AWS Account ID (top-right of the AWS Console),
                Azure Subscription ID (Subscriptions blade), or GCP Project ID (top of the Cloud Console).
              </FieldLabel>
              <input
                placeholder="Account/Subscription ID"
                value={newAccount.accountId}
                onChange={(e) => setNewAccount({ ...newAccount, accountId: e.target.value })}
              />
            </div>
            <div>
              <FieldLabel label="Regions">
                Comma-separated region codes to scan, e.g. <b>us-east-1,eu-west-1</b> for AWS or <b>eastus</b> for
                Azure. Leave blank to scan every available region — slower, but nothing gets missed.
              </FieldLabel>
              <input
                placeholder="Regions (comma-separated, e.g., us-east-1,eu-west-1)"
                value={newAccount.regions}
                onChange={(e) => setNewAccount({ ...newAccount, regions: e.target.value })}
              />
            </div>
            <div>
              <FieldLabel label="Access mode">
                <b>Agent-based</b>: an already-connected Remotely agent on your network reports resources it can see
                (needed for on-prem/VMware/Proxmox). <b>Direct API</b>: the control plane calls the cloud provider's
                API directly using credentials you supply at sync time — nothing installed on your side.
              </FieldLabel>
              <select
                value={newAccount.accessMode}
                onChange={(e) => setNewAccount({ ...newAccount, accessMode: e.target.value })}
              >
                <option value="agent">Agent-based discovery</option>
                <option value="api">Direct API access</option>
              </select>
            </div>
            {newAccount.accessMode === "agent" && (
              <div>
                <FieldLabel label="Agent IDs">
                  Comma-separated agent hostnames that should report resources for this account — find exact names
                  on the <b>Agent Health</b> page.
                </FieldLabel>
                <input
                  placeholder="Agent IDs (comma-separated)"
                  value={newAccount.agentIds}
                  onChange={(e) => setNewAccount({ ...newAccount, agentIds: e.target.value })}
                />
              </div>
            )}
            <div className="form-actions">
              <button className="btn-primary" onClick={addAccount}>Save</button>
              <button className="btn-secondary" onClick={() => setShowAddAccount(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="accounts-list">
          {accounts.length === 0 ? (
            <p className="empty-state">
              No infrastructure accounts configured. Add one to start discovering resources.
            </p>
          ) : (
            accounts.map((acc) =>
              editingAccountId === acc.id ? (
                <div key={acc.id} className="add-account-form edit-account-form">
                  <input
                    placeholder="Account Name (e.g., Production AWS)"
                    value={editAccount.name}
                    onChange={(e) => setEditAccount({ ...editAccount, name: e.target.value })}
                  />
                  <select
                    value={editAccount.provider}
                    onChange={(e) => setEditAccount({ ...editAccount, provider: e.target.value })}
                  >
                    <option value="aws">AWS</option>
                    <option value="azure">Azure</option>
                    <option value="gcp">GCP</option>
                    <option value="vmware">VMware</option>
                    <option value="proxmox">Proxmox</option>
                    <option value="on-prem">On-Premise</option>
                  </select>
                  <input
                    placeholder="Account/Subscription ID"
                    value={editAccount.accountId}
                    onChange={(e) => setEditAccount({ ...editAccount, accountId: e.target.value })}
                  />
                  <input
                    placeholder="Regions (comma-separated, e.g., us-east-1,eu-west-1)"
                    value={editAccount.regions}
                    onChange={(e) => setEditAccount({ ...editAccount, regions: e.target.value })}
                  />
                  <select
                    value={editAccount.accessMode}
                    onChange={(e) => setEditAccount({ ...editAccount, accessMode: e.target.value })}
                  >
                    <option value="agent">Agent-based discovery</option>
                    <option value="api">Direct API access</option>
                  </select>
                  {editAccount.accessMode === "agent" && (
                    <input
                      placeholder="Agent IDs (comma-separated)"
                      value={editAccount.agentIds}
                      onChange={(e) => setEditAccount({ ...editAccount, agentIds: e.target.value })}
                    />
                  )}
                  <label className="edit-enabled-toggle">
                    <input
                      type="checkbox"
                      checked={editAccount.enabled}
                      onChange={(e) => setEditAccount({ ...editAccount, enabled: e.target.checked })}
                    />
                    Enabled
                  </label>
                  <div className="form-actions">
                    <button className="btn-primary" onClick={saveEdit}>Save</button>
                    <button className="btn-secondary" onClick={() => setEditingAccountId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div key={acc.id} className="account-card">
                  <div className="account-info">
                    <span className="account-icon">{providerIcon(acc.provider)}</span>
                    <div>
                      <strong>{acc.name}</strong>
                      <div className="account-meta">
                        {acc.provider} • {acc.accountId} • {acc.accessMode}
                        {acc.regions.length > 0 && ` • ${acc.regions.join(", ")}`}
                      </div>
                      {acc.lastSyncAt && (
                        <div className="account-sync">
                          Last sync: {new Date(acc.lastSyncAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="account-actions">
                    <span className={`status-dot ${acc.enabled ? "active" : "inactive"}`} />
                    <button className="btn-sm" onClick={() => startEdit(acc)}>
                      Edit
                    </button>
                    <button className="btn-sm btn-danger" onClick={() => deleteAccount(acc.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              )
            )
          )}
        </div>
      </div>
    </div>
  );
}

// Renders Mermaid source using the bundled `mermaid` package (no CDN/network
// dependency, so it works offline and isn't subject to CSP/script-injection
// races when multiple diagrams render at once).
function MermaidDiagram({ content }: { content: string }) {
  const [svg, setSvg] = useState<string>("");
  const [renderError, setRenderError] = useState("");

  useEffect(() => {
    let cancelled = false;
    ensureMermaidInitialized();
    mermaid
      .render("mermaid-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8), content)
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg);
      })
      .catch((err: Error) => {
        if (!cancelled) setRenderError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [content]);

  if (renderError) {
    return (
      <div>
        <p className="render-error">Diagram render error: {renderError}</p>
        <pre className="diagram-source">{content}</pre>
      </div>
    );
  }

  if (!svg) return <p className="empty-state">Rendering…</p>;

  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}

// Copy-to-clipboard with visible success/failure feedback and a fallback for
// environments where navigator.clipboard is unavailable or denied (e.g. an
// embedded webview without clipboard-write permission) — the old handler
// called writeText() with no .catch() at all, so a rejected promise failed
// completely silently and looked indistinguishable from "nothing to copy".
function CopySourceButton({ content }: { content: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        throw new Error("Clipboard API unavailable");
      }
      setStatus("copied");
    } catch {
      // Fallback: select-and-copy via a hidden textarea
      try {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        setStatus("copied");
      } catch {
        setStatus("failed");
      }
    }
    setTimeout(() => setStatus("idle"), 2000);
  };

  return (
    <button className="btn-sm" onClick={copy}>
      {status === "copied" ? "✅ Copied" : status === "failed" ? "❌ Copy failed" : "📋 Copy Source"}
    </button>
  );
}

function providerIcon(provider: string): string {
  const icons: Record<string, string> = {
    aws: "☁️",
    azure: "🔷",
    gcp: "🟡",
    vmware: "🖥️",
    proxmox: "🟩",
    "on-prem": "🏢",
    other: "📦",
  };
  return icons[provider] || "📦";
}
