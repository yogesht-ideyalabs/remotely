import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getSession, fetchBranding, type Branding } from "./api";
import ThemeSwitcher from "./ThemeSwitcher";
import NotificationBell from "./NotificationBell";
import CommandPalette from "./CommandPalette";
import ProfileMenu from "./ProfileMenu";
import { OrgProvider } from "./OrgContext";
import OrgSwitcher from "./OrgSwitcher";
import Sidebar from "./Sidebar";

// Static prefix match is enough here — dynamic segments (:resourceId etc.)
// fall through to their nearest static ancestor's title (e.g.
// /terminal/abc123 -> "Terminal"), which is the right granularity for a
// browser tab title anyway.
const PAGE_TITLES: [string, string][] = [
  ["/resources", "Resources"],
  ["/terminal", "Terminal"],
  ["/rdp", "RDP"],
  ["/db", "Database"],
  ["/audit", "Audit Log"],
  ["/recordings", "Recordings"],
  ["/admin/connections", "Connections"],
  ["/admin/users", "Users"],
  ["/admin/roles", "Roles"],
  ["/admin/organizations", "Organizations"],
  ["/admin/siem", "SIEM Export"],
  ["/admin/compliance", "Compliance"],
  ["/admin/plugins", "Plugins"],
  ["/notifications", "Notifications"],
  ["/admin/agents", "Agent Health"],
  ["/files", "Files"],
  ["/active-sessions", "Active Sessions"],
  ["/profile", "Profile"],
  ["/dashboard", "Dashboard"],
  ["/watch", "Watch Session"],
  ["/access-requests", "Access Requests"],
  ["/admin/infra-map", "Infrastructure Map"],
  ["/admin/snapshots", "Snapshots"],
  ["/admin/diagram-editor", "Diagram Editor"],
  ["/admin/architecture", "Architecture"],
  ["/admin/monitors", "Uptime Monitors"],
];

function useDocumentTitle(brandName: string) {
  const location = useLocation();
  useEffect(() => {
    // Longest-prefix match so a more specific route (e.g. /admin/infra-map)
    // wins over a shorter one that happens to also prefix-match.
    const match = PAGE_TITLES.filter(([prefix]) => location.pathname.startsWith(prefix)).sort((a, b) => b[0].length - a[0].length)[0];
    document.title = match ? `${match[1]} · ${brandName}` : brandName;
  }, [location.pathname, brandName]);
}

export default function Layout() {
  const session = getSession();
  const [branding, setBranding] = useState<Branding | null>(null);

  useEffect(() => {
    if (session) fetchBranding().then(setBranding).catch(() => {});
  }, [session]);

  useDocumentTitle(branding?.brandName || "Remotely");

  if (!session) return <Navigate to="/login" replace />;

  return (
    <OrgProvider>
      <div className="app-shell">
        <Sidebar branding={branding} />
        <div className="content-column">
          <div className="topbar">
            <div className="topbar-center">
              <button
                className="center-search-btn"
                onClick={() => window.dispatchEvent(new Event("remotely:open-palette"))}
              >
                🔍 <span className="label">Search or jump to...</span>
                <span className="kbd-hint">⌘K</span>
              </button>
            </div>
            <div className="topbar-right">
              <div className="control-pod">
                <OrgSwitcher />
                <div className="divider" />
                <ThemeSwitcher />
                <div className="divider" />
                <NotificationBell />
              </div>
              <ProfileMenu />
            </div>
          </div>
          <div className="main">
            <Outlet />
          </div>
        </div>
        <CommandPalette />
      </div>
    </OrgProvider>
  );
}
