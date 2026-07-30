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
      <div className="page-header-row">
        <div>
          <h2 className="page-title">Resources</h2>
          <p className="page-sub">
            Connect to your infrastructure — only resources your role permits appear here.
          </p>
        </div>
      </div>

      <div className="resource-toolbar">
        <div className="resource-search-wrap">
          <span className="resource-search-icon">🔍</span>
          <input
            className="resource-search"
            placeholder="Search by name, folder, label, or type..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="resource-search-clear" onClick={() => setQuery("")}>✕</button>
          )}
        </div>
        {filtered && (
          <span className="resource-count">{filtered.length} resource{filtered.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}
      {resources === null && <Skeleton lines={5} />}
      {filtered && filtered.length === 0 && resources && resources.length > 0 && (
        <EmptyState icon="resources" message="No resources match your search." />
      )}
      {resources && resources.length === 0 && getSession()?.isAdmin && (
        <EmptyState
          icon="resources"
          message="Nothing here yet. Add a connection (SSH, RDP, VNC, Database, or Kubernetes) or deploy an agent."
          action={{ label: "Go to Connections →", onClick: () => navigate("/admin/connections") }}
        />
      )}
      {resources && resources.length === 0 && !getSession()?.isAdmin && (
        <EmptyState icon="resources" message="No resources visible to your current role — ask an admin to grant access." />
      )}

      {groups &&
        groups.map(([folder, items]) => (
          <div key={folder} className="resource-folder-group">
            <h3 className="resource-folder-title">
              {folder} <span className="resource-folder-count">{items.length}</span>
            </h3>
            <div className="resource-grid">
              {items.map((r) => (
                <div className="resource-card" key={r.id} onClick={() => navigate(connectPath(r))}>
                  <div className="resource-card-top">
                    <span className="resource-type-icon">{typeIcon(r.type)}</span>
                    <div className="resource-card-info">
                      <span className="resource-hostname">{r.hostname}</span>
                      <span className="resource-type-label">{r.type}</span>
                    </div>
                    <span className="resource-status-dot" />
                  </div>
                  {Object.keys(r.labels).length > 0 && (
                    <div className="labels">
                      {Object.entries(r.labels).slice(0, 4).map(([k, v]) => (
                        <span className="label-chip" key={k}>{k}={v}</span>
                      ))}
                      {Object.keys(r.labels).length > 4 && (
                        <span className="label-chip">+{Object.keys(r.labels).length - 4}</span>
                      )}
                    </div>
                  )}
                  <div className="resource-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="connect-btn connect-btn-primary" onClick={() => navigate(connectPath(r))}>
                      Connect
                    </button>
                    {(r.type === "ssh-direct" || r.type === "ssh-agent") && (
                      <button className="connect-btn" onClick={() => navigate(`/files/${r.id}${r.type === "ssh-agent" ? "?kind=ssh-agent" : ""}`)}>
                        Files
                      </button>
                    )}
                    {r.type === "kubernetes" && (
                      <button className="connect-btn" onClick={() => navigate(`/k8s/${r.id}`)}>
                        Browse
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}


function typeIcon(type: string): string {
  const icons: Record<string, string> = {
    "ssh-agent": "🖥️",
    "ssh-direct": "💻",
    "rdp": "🪟",
    "vnc": "🖥️",
    "database": "🗄️",
    "kubernetes": "☸️",
    "terraform": "🏗️",
  };
  return icons[type] || "📦";
}
