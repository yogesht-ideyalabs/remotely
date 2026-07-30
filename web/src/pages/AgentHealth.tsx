import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import {
  fetchAgents,
  triggerAgentUpdate,
  fetchJoinTokens,
  createJoinTokenApi,
  revokeJoinTokenApi,
  getSession,
  type AgentHealthInfo,
  type JoinTokenItem,
} from "../api";
import { LabelChips } from "../components/LabelChips";
import { FieldLabel } from "../components/FieldLabel";
import { StatusBadge, type StatusTone } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ${seconds % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function healthTone(lastSeenSecondsAgo: number): StatusTone {
  // Agents ping every 20s — comfortably healthy is <45s, degraded <120s,
  // beyond that the control plane just hasn't heard from it in a while
  // (or it's dead and the WS hasn't noticed yet).
  if (lastSeenSecondsAgo < 45) return "ok";
  if (lastSeenSecondsAgo < 120) return "warn";
  return "danger";
}

function healthLabel(lastSeenSecondsAgo: number): string {
  if (lastSeenSecondsAgo < 45) return "healthy";
  if (lastSeenSecondsAgo < 120) return "degraded";
  return "unresponsive";
}

function tokenStatusTone(status: string): StatusTone {
  if (status === "active") return "ok";
  if (status === "expired") return "warn";
  if (status === "revoked") return "danger";
  return "neutral";
}

export default function AgentHealth() {
  const isFullAdmin = Boolean(getSession()?.isAdmin);
  const [agents, setAgents] = useState<AgentHealthInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function load() {
      fetchAgents().then(setAgents).catch((e) => setError(e.message));
    }
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  async function update(a: AgentHealthInfo) {
    if (!confirm(`Trigger a self-update on ${a.hostname}?`)) return;
    try {
      await triggerAgentUpdate(a.id);
      alert("Update triggered — the agent will download and restart into the new version if AGENT_UPDATE_URL is configured.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "update trigger failed");
    }
  }

  return (
    <div>
      <div className="page-header-row">
        <div>
          <h2 className="page-title">Agent Health</h2>
          <p className="page-sub">Live reverse-tunnel agents — uptime, heartbeat, latency. Refreshes every 10s.</p>
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {agents === null && <Skeleton lines={4} />}
      {agents && agents.length === 0 && (
        <EmptyState icon="bars" message="No agents currently connected." />
      )}
      {agents && agents.length > 0 && (
        <div className="admin-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Hostname</th>
                <th>Labels</th>
                <th>Version</th>
                <th>Identity</th>
                <th>Uptime</th>
                <th>Last heartbeat</th>
                <th>Latency</th>
                <th>Active sessions</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td>
                    <StatusBadge tone={healthTone(a.lastSeenSecondsAgo)}>{healthLabel(a.lastSeenSecondsAgo)}</StatusBadge>
                  </td>
                  <td>{a.hostname}</td>
                  <td>
                    <LabelChips labels={a.labels} />
                  </td>
                  <td>
                    {a.version}
                    {a.updateAvailable && (
                      <span className="hint" style={{ margin: 0, marginLeft: 6, color: "var(--accent)" }}>
                        update available
                      </span>
                    )}
                  </td>
                  <td>
                    {a.hasIdentity ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <Icon name="key" size={12} /> registered
                      </span>
                    ) : (
                      "legacy token"
                    )}
                  </td>
                  <td>{formatDuration(a.uptimeSeconds)}</td>
                  <td>{a.lastSeenSecondsAgo}s ago</td>
                  <td>{a.lastLatencyMs === null ? "—" : `${a.lastLatencyMs}ms`}</td>
                  <td>{a.activeSessions}</td>
                  <td>
                    {a.updateAvailable && (
                      <button className="link" onClick={() => update(a)}>
                        update
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isFullAdmin && <JoinTokensSection />}
    </div>
  );
}

function JoinTokensSection() {
  const [tokens, setTokens] = useState<JoinTokenItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [ttlMinutes, setTtlMinutes] = useState("60");
  const [justCreated, setJustCreated] = useState<string | null>(null);

  function load() {
    fetchJoinTokens().then(setTokens).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await createJoinTokenApi(label, Number(maxUses) || 1, Number(ttlMinutes) || 60);
      setJustCreated(created.token);
      setLabel("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    }
  }

  async function revoke(token: string) {
    if (!confirm("Revoke this join token? Any agent that hasn't used it yet won't be able to.")) return;
    try {
      await revokeJoinTokenApi(token);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "revoke failed");
    }
  }

  return (
    <div className="section-card" style={{ marginTop: 24 }}>
      <h3>Agent join tokens</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Single-use (or limited-use), expiring credentials for onboarding new agents — replaces the static shared
        secret for anything beyond the seeded demo agents. Once an agent joins with a token, it registers its own
        keypair and never needs a token again; the token itself is consumed and can't be reused.
      </p>
      {error && <div className="error-banner">{error}</div>}

      {justCreated && (
        <div className="section-card" style={{ background: "var(--bg)" }}>
          <div className="hint" style={{ marginTop: 0 }}>
            New token (shown once — pass it to the agent as AGENT_JOIN_TOKEN):
          </div>
          <code style={{ fontSize: 13, wordBreak: "break-all" }}>{justCreated}</code>
          <div>
            <button className="link" onClick={() => setJustCreated(null)}>
              dismiss
            </button>
          </div>
        </div>
      )}

      <form className="form-row" onSubmit={create}>
        <div>
          <FieldLabel label="Label">
            A short, memorable name for this token — e.g. the client or rollout it's for. Shown in the token list
            below so you can tell tokens apart; purely informational.
          </FieldLabel>
          <input placeholder="label, e.g. new-client-rollout" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div>
          <FieldLabel label="Max uses">
            How many agents can register with this exact token before it's exhausted. Use <b>1</b> for a single new
            agent (the common case); higher for bulk-onboarding a batch at once.
          </FieldLabel>
          <input placeholder="max uses" type="number" style={{ width: 100 }} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
        </div>
        <div>
          <FieldLabel label="TTL (minutes)">
            How long the token stays valid before it expires unused. Keep this short — a leaked join token is a
            credential an attacker could use to register a rogue agent.
          </FieldLabel>
          <input placeholder="ttl minutes" type="number" style={{ width: 110 }} value={ttlMinutes} onChange={(e) => setTtlMinutes(e.target.value)} />
        </div>
        <button className="primary" style={{ width: "auto", padding: "8px 16px", marginTop: 20 }}>
          Generate token
        </button>
      </form>

      {tokens && tokens.length > 0 && (
        <table className="audit-table" style={{ marginTop: 12 }}>
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
              const expired = Date.now() > t.expiresAt;
              const exhausted = t.uses >= t.maxUses;
              const status = t.revoked ? "revoked" : expired ? "expired" : exhausted ? "used up" : "active";
              return (
                <tr key={t.token}>
                  <td>{t.label || "—"}</td>
                  <td>
                    {t.uses} / {t.maxUses}
                  </td>
                  <td>{new Date(t.expiresAt).toLocaleString()}</td>
                  <td>
                    <StatusBadge tone={tokenStatusTone(status)}>{status}</StatusBadge>
                  </td>
                  <td>
                    {status === "active" && (
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
      )}
    </div>
  );
}
