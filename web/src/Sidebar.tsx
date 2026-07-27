import { useEffect, useState } from "react";
import { NavLink, Link } from "react-router-dom";
import { getSession, type Branding } from "./api";

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const PRIMARY_ITEMS: NavItem[] = [
  { to: "/resources", label: "Resources", icon: "🖥️" },
  { to: "/access-requests", label: "Access", icon: "🔑" },
];

// Same permission gating AdminMenu.tsx used to apply as a dropdown — kept
// identical here since this sidebar replaces it, not just relocates it.
function buildAdminItems(session: NonNullable<ReturnType<typeof getSession>>): NavItem[] {
  const items: NavItem[] = [];
  items.push({ to: "/dashboard", label: "Dashboard", icon: "📊" });
  items.push({ to: "/admin/infra-map", label: "Infrastructure Map", icon: "🗺️" });
  items.push({ to: "/admin/snapshots", label: "Snapshots", icon: "📸" });
  items.push({ to: "/admin/architecture", label: "Architecture", icon: "🏗️" });
  items.push({ to: "/admin/diagram-editor", label: "Diagram Editor", icon: "✏️" });
  items.push({ to: "/active-sessions", label: "Active Sessions", icon: "📡" });
  items.push({ to: "/audit", label: "Audit Log", icon: "📜" });
  if (session.isAdmin) items.push({ to: "/recordings", label: "Recordings", icon: "🎥" });
  items.push({ to: "/admin/connections", label: "Connections", icon: "🔌" });
  items.push({ to: "/admin/agents", label: "Agent Health", icon: "💓" });
  items.push({ to: "/admin/users", label: "Users", icon: "👥" });
  if (session.isAdmin) {
    items.push({ to: "/admin/roles", label: "Roles", icon: "🛡️" });
    items.push({ to: "/admin/organizations", label: "Organizations", icon: "🏢" });
    items.push({ to: "/admin/siem", label: "SIEM Export", icon: "📤" });
    items.push({ to: "/admin/compliance", label: "Compliance", icon: "✅" });
    items.push({ to: "/admin/plugins", label: "Plugins", icon: "🧩" });
  }
  return items;
}

const COLLAPSE_KEY = "remotely_sidebar_collapsed";

export default function Sidebar({ branding }: { branding: Branding | null }) {
  const session = getSession();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  if (!session) return null;
  const anyAdmin = session.isAdmin || session.isDelegatedAdmin;
  const adminItems = anyAdmin ? buildAdminItems(session) : [];

  return (
    <div className={`sidebar${collapsed ? " sidebar-collapsed" : ""}`}>
      <div className="sidebar-header">
        <Link to="/resources" className="brand">
          {branding?.logoDataUri ? (
            <img src={branding.logoDataUri} alt="" style={{ width: 20, height: 20, borderRadius: 5, objectFit: "cover" }} />
          ) : (
            <span className="dot" style={branding?.brandColor ? { background: branding.brandColor, boxShadow: `0 0 8px ${branding.brandColor}` } : undefined} />
          )}
          {!collapsed && (branding?.brandName || "Remotely")}
        </Link>
      </div>

      <nav className="sidebar-nav">
        {PRIMARY_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "active" : "")} title={item.label}>
            <span className="sidebar-icon">{item.icon}</span>
            {!collapsed && <span className="sidebar-label">{item.label}</span>}
          </NavLink>
        ))}

        {adminItems.length > 0 && (
          <>
            {!collapsed && <div className="sidebar-section-label">Admin</div>}
            {collapsed && <div className="sidebar-divider" />}
            {adminItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "active" : "")} title={item.label}>
                <span className="sidebar-icon">{item.icon}</span>
                {!collapsed && <span className="sidebar-label">{item.label}</span>}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      <button
        className="sidebar-collapse-btn"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? "»" : "« Collapse"}
      </button>
    </div>
  );
}
