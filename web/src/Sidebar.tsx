import { useEffect, useState } from "react";
import { NavLink, Link } from "react-router-dom";
import { Icon } from "./Icon";
import { getSession, type Branding } from "./api";

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const PRIMARY_ITEMS: NavItem[] = [
  { to: "/resources", label: "Resources", icon: "resources" },
  { to: "/access-requests", label: "Access", icon: "key" },
];

// Same permission gating AdminMenu.tsx used to apply as a dropdown — kept
// identical here since this sidebar replaces it, not just relocates it.
function buildAdminItems(session: NonNullable<ReturnType<typeof getSession>>): NavItem[] {
  const items: NavItem[] = [];
  items.push({ to: "/dashboard", label: "Dashboard", icon: "grid" });
  items.push({ to: "/admin/infra-map", label: "Infrastructure Map", icon: "map" });
  items.push({ to: "/admin/snapshots", label: "Snapshots", icon: "camera" });
  items.push({ to: "/admin/architecture", label: "Architecture", icon: "layers" });
  items.push({ to: "/admin/diagram-editor", label: "Diagram Editor", icon: "pen" });
  items.push({ to: "/active-sessions", label: "Active Sessions", icon: "activity" });
  items.push({ to: "/audit", label: "Audit Log", icon: "list" });
  if (session.isAdmin) items.push({ to: "/recordings", label: "Recordings", icon: "play-circle" });
  items.push({ to: "/admin/connections", label: "Connections", icon: "plug" });
  items.push({ to: "/admin/agents", label: "Agent Health", icon: "bars" });
  items.push({ to: "/admin/users", label: "Users", icon: "users" });
  if (session.isAdmin) {
    items.push({ to: "/admin/roles", label: "Roles", icon: "shield" });
    items.push({ to: "/admin/organizations", label: "Organizations", icon: "building" });
    items.push({ to: "/admin/monitors", label: "Uptime Monitors", icon: "radar" });
    items.push({ to: "/admin/siem", label: "SIEM Export", icon: "upload" });
    items.push({ to: "/admin/compliance", label: "Compliance", icon: "check-shield" });
    items.push({ to: "/admin/plugins", label: "Plugins", icon: "puzzle" });
    items.push({ to: "/admin/security-policy", label: "Security Policy", icon: "lock" });
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
      <div className="sidebar-brand">
        <Link to="/resources">
          {branding?.logoDataUri ? (
            <img src={branding.logoDataUri} alt="" style={{ width: 20, height: 20, borderRadius: 5, objectFit: "cover" }} />
          ) : (
            <span className="dot" style={branding?.brandColor ? { background: branding.brandColor, boxShadow: `0 0 8px ${branding.brandColor}` } : undefined} />
          )}
        </Link>
        {!collapsed && (branding?.brandName || "Remotely")}
      </div>

      <nav className="sidebar-nav">
        {PRIMARY_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => `sidebar-item${isActive ? " active" : ""}`} title={item.label}>
            <Icon name={item.icon} />
            {!collapsed && item.label}
          </NavLink>
        ))}

        {adminItems.length > 0 && (
          <>
            {!collapsed && <div className="sidebar-section">Admin</div>}
            {adminItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `sidebar-item${isActive ? " active" : ""}`} title={item.label}>
                <Icon name={item.icon} />
                {!collapsed && item.label}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      <button className="sidebar-foot" onClick={() => setCollapsed((c) => !c)} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        <Icon name="chevron-left" size={12} style={{ transform: collapsed ? "rotate(180deg)" : undefined, verticalAlign: -1 }} />
        {!collapsed && " Collapse"}
      </button>
    </div>
  );
}
