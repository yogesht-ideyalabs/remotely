import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, Link } from "react-router-dom";
import { getSession, fetchBranding, type Branding } from "./api";
import ThemeSwitcher from "./ThemeSwitcher";
import NotificationBell from "./NotificationBell";
import CommandPalette from "./CommandPalette";
import AdminMenu from "./AdminMenu";
import ProfileMenu from "./ProfileMenu";
import { OrgProvider } from "./OrgContext";
import OrgSwitcher from "./OrgSwitcher";

export default function Layout() {
  const session = getSession();
  const [branding, setBranding] = useState<Branding | null>(null);

  useEffect(() => {
    if (session) fetchBranding().then(setBranding).catch(() => {});
  }, [session]);

  if (!session) return <Navigate to="/login" replace />;

  return (
    <OrgProvider>
      <div className="app-shell">
        <div className="topbar">
          <div className="topbar-left">
            <Link to="/resources" className="brand">
              {branding?.logoDataUri ? (
                <img src={branding.logoDataUri} alt="" style={{ width: 20, height: 20, borderRadius: 5, objectFit: "cover" }} />
              ) : (
                <span className="dot" style={branding?.brandColor ? { background: branding.brandColor, boxShadow: `0 0 8px ${branding.brandColor}` } : undefined} />
              )}
              {branding?.brandName || "Remotely"}
            </Link>
            <div className="nav">
              <NavLink to="/resources" className={({ isActive }) => (isActive ? "active" : "")}>
                Resources
              </NavLink>
              <NavLink to="/access-requests" className={({ isActive }) => (isActive ? "active" : "")}>
                Access
              </NavLink>
              <AdminMenu />
            </div>
          </div>
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
        <CommandPalette />
      </div>
    </OrgProvider>
  );
}
