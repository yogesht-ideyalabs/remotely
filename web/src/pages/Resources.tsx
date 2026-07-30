import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchResources, getSession, type Resource } from "../api";
import { useOrgFilter } from "../OrgContext";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";

function connectPath(r: Resource): string {
  if (r.type === "rdp") return `/rdp/${r.id}`;
  if (r.type === "vnc") return `/vnc/${r.id}`;
  if (r.type === "database") return `/db/${r.id}`;
  return `/terminal/${r.id}?kind=${r.type}`;
}

export default function Resources() {
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { selected: selectedOrg } = useOrgFilter();

  useEffect(() => {
    fetchResources()
      .then(setResources)
      .catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    if (!resources) return null;
    let list = resources;
    if (selectedOrg) list = list.filter((r) => r.labels.client === selectedOrg);
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => {
      const haystack = [r.hostname, r.type, r.folder, ...Object.entries(r.labels).map(([k, v]) => `${k}=${v}`)]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [resources, query, selectedOrg]);

  const groups = useMemo(() => {
    if (!filtered) return null;
    const byFolder = new Map<string, Resource[]>();
    for (const r of filtered) {
      const key = r.folder || "Uncategorized";
      if (!byFolder.has(key)) byFolder.set(key, []);
      byFolder.get(key)!.push(r);
    }
    return Array.from(byFolder.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div>
      <h2 className="page-title">Resources</h2>
      <p className="page-sub">
        Only resources your role can see appear here — this list is filtered server-side, the
        same way a real deployment hides entire tenants from each other, not just denies access.
      </p>
      <input
        placeholder="Search by name, folder, label, or type..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ maxWidth: 420, marginBottom: 20 }}
      />
      {error && <div className="error-banner">{error}</div>}
      {resources === null && <Skeleton lines={5} />}
      {filtered && filtered.length === 0 && resources && resources.length > 0 && (
        <EmptyState icon="resources" message="No resources match your search." />
      )}
      {resources && resources.length === 0 && getSession()?.isAdmin && (
        <EmptyState
          icon="resources"
          message="Nothing here yet — this is what a fresh install looks like. Add a connection (SSH, RDP, VNC, a database, or a Kubernetes pod) to get started, or deploy an agent to have a client network report in on its own."
          action={{ label: "Go to Connections →", onClick: () => navigate("/admin/connections") }}
        />
      )}
      {resources && resources.length === 0 && !getSession()?.isAdmin && (
        <EmptyState icon="resources" message="No resources visible to your current role yet — ask an admin to grant you access." />
      )}
      {groups &&
        groups.map(([folder, items]) => (
          <div key={folder} style={{ marginBottom: 28 }}>
            <h3 style={{ fontSize: 13, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
              {folder} <span style={{ opacity: 0.6 }}>({items.length})</span>
            </h3>
            <div className="resource-grid">
              {items.map((r) => (
                <div className="resource-card" key={r.id}>
                  <div className="host">
                    <span className="dot" />
                    {r.hostname}
                    <span className="label-chip">{r.type}</span>
                  </div>
                  <div className="labels">
                    {Object.entries(r.labels).map(([k, v]) => (
                      <span className="label-chip" key={k}>
                        {k}={v}
                      </span>
                    ))}
                  </div>
                  <button className="connect-btn connect-btn-primary" onClick={() => navigate(connectPath(r))}>
                    Connect →
                  </button>
                  {(r.type === "ssh-direct" || r.type === "ssh-agent") && (
                    <button
                      className="connect-btn"
                      style={{ marginTop: 6 }}
                      onClick={() => navigate(`/files/${r.id}${r.type === "ssh-agent" ? "?kind=ssh-agent" : ""}`)}
                    >
                      Files
                    </button>
                  )}
                  {r.type === "kubernetes" && (
                    <button className="connect-btn" style={{ marginTop: 6 }} onClick={() => navigate(`/k8s/${r.id}`)}>
                      Browse Cluster
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
