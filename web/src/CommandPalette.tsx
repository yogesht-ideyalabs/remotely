import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchResources, getSession, type Resource } from "./api";

function connectPath(r: Resource): string {
  if (r.type === "rdp") return `/rdp/${r.id}`;
  if (r.type === "database") return `/db/${r.id}`;
  return `/terminal/${r.id}?kind=${r.type}`;
}

const RESOURCE_TYPE_SECTION: Record<string, string> = {
  "ssh-agent": "SSH (agent)",
  "ssh-direct": "SSH (direct)",
  rdp: "RDP",
  database: "Database",
};

interface Item {
  key: string;
  label: string;
  sublabel: string;
  path: string;
  section: string;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [resources, setResources] = useState<Resource[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const session = getSession();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    function onOpenRequest() {
      setOpen(true);
    }
    window.addEventListener("remotely:open-palette", onOpenRequest);
    return () => window.removeEventListener("remotely:open-palette", onOpenRequest);
  }, []);

  useEffect(() => {
    if (open) {
      fetchResources()
        .then(setResources)
        .catch(() => setResources([]));
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const pages: Item[] = useMemo(() => {
    if (!session) return [];
    const anyAdmin = session.isAdmin || session.isDelegatedAdmin;
    const items: Item[] = [
      { key: "p-resources", label: "Resources", sublabel: "browse & connect", path: "/resources", section: "Pages" },
      { key: "p-access-requests", label: "Access Requests", sublabel: "request or approve access", path: "/access-requests", section: "Pages" },
      { key: "p-profile", label: "Profile & settings", sublabel: "your account", path: "/profile", section: "Pages" },
    ];
    if (anyAdmin) items.push({ key: "p-dashboard", label: "Dashboard", sublabel: "admin overview", path: "/dashboard", section: "Pages" });
    if (anyAdmin) items.push({ key: "p-sessions", label: "Active Sessions", sublabel: "live sessions", path: "/active-sessions", section: "Pages" });
    if (anyAdmin) items.push({ key: "p-audit", label: "Audit Log", sublabel: "event history", path: "/audit", section: "Pages" });
    if (session.isAdmin) items.push({ key: "p-recordings", label: "Recordings", sublabel: "session replays", path: "/recordings", section: "Pages" });
    if (anyAdmin) {
      items.push({ key: "p-connections", label: "Connections", sublabel: "manage resources", path: "/admin/connections", section: "Pages" });
      items.push({ key: "p-agents", label: "Agent Health", sublabel: "agent status", path: "/admin/agents", section: "Pages" });
      items.push({ key: "p-users", label: "Users", sublabel: "manage users", path: "/admin/users", section: "Pages" });
    }
    if (session.isAdmin) {
      items.push({ key: "p-roles", label: "Roles", sublabel: "manage permissions", path: "/admin/roles", section: "Pages" });
      items.push({ key: "p-orgs", label: "Organizations", sublabel: "manage tenants", path: "/admin/organizations", section: "Pages" });
      items.push({ key: "p-siem", label: "SIEM Export", sublabel: "audit log forwarding", path: "/admin/siem", section: "Pages" });
    }
    return items;
  }, [session]);

  const resourceItems: Item[] = useMemo(
    () =>
      resources.map((r) => ({
        key: `r-${r.id}`,
        label: r.hostname,
        sublabel: r.folder || "uncategorized",
        path: connectPath(r),
        section: RESOURCE_TYPE_SECTION[r.type] ?? r.type,
      })),
    [resources]
  );

  const allItems = [...pages, ...resourceItems];

  // Deliberately empty until the user actually types something — dumping
  // every page and every resource the moment ⌘K opens is what looked
  // cluttered and unhelpful before.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allItems.filter((i) => `${i.label} ${i.sublabel} ${i.section}`.toLowerCase().includes(q));
  }, [allItems, query]);

  const sections = useMemo(() => {
    const order: string[] = [];
    const bySection = new Map<string, Item[]>();
    for (const item of filtered) {
      if (!bySection.has(item.section)) {
        bySection.set(item.section, []);
        order.push(item.section);
      }
      bySection.get(item.section)!.push(item);
    }
    return order.map((section) => ({ section, items: bySection.get(section)! }));
  }, [filtered]);

  function activate(item: Item) {
    setOpen(false);
    navigate(item.path);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[selectedIdx]) {
      activate(filtered[selectedIdx]);
    }
  }

  if (!open) return null;

  let flatIdx = -1;

  return (
    <div className="cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="cmdk-panel" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Search pages and resources..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIdx(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="cmdk-list">
          {!query.trim() && <div className="cmdk-empty">Start typing to search pages and resources...</div>}
          {query.trim() && filtered.length === 0 && <div className="cmdk-empty">No matches</div>}
          {sections.map(({ section, items }) => (
            <div key={section} className="cmdk-section">
              <div className="cmdk-section-header">{section}</div>
              {items.map((item) => {
                flatIdx++;
                const idx = flatIdx;
                return (
                  <div
                    key={item.key}
                    className={`cmdk-item ${idx === selectedIdx ? "selected" : ""}`}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    onClick={() => activate(item)}
                  >
                    <span>{item.label}</span>
                    <span className="cmdk-sublabel">{item.sublabel}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
