import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { getSession } from "./api";
import { useDismiss } from "./useDismiss";

interface MenuItem {
  to: string;
  label: string;
}

export default function AdminMenu() {
  const session = getSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useDismiss(ref, open, () => setOpen(false));
  useEffect(() => setOpen(false), [location.pathname]);

  if (!session) return null;
  const anyAdmin = session.isAdmin || session.isDelegatedAdmin;
  if (!anyAdmin) return null;

  const items: MenuItem[] = [];
  items.push({ to: "/dashboard", label: "Dashboard" });
  items.push({ to: "/admin/infra-map", label: "Infrastructure Map" });
  items.push({ to: "/active-sessions", label: "Active Sessions" });
  items.push({ to: "/audit", label: "Audit Log" });
  if (session.isAdmin) items.push({ to: "/recordings", label: "Recordings" });
  items.push({ to: "/admin/connections", label: "Connections" });
  items.push({ to: "/admin/agents", label: "Agent Health" });
  items.push({ to: "/admin/users", label: "Users" });
  if (session.isAdmin) {
    items.push({ to: "/admin/roles", label: "Roles" });
    items.push({ to: "/admin/organizations", label: "Organizations" });
    items.push({ to: "/admin/siem", label: "SIEM Export" });
  }

  const adminPaths = items.map((i) => i.to);
  const isInAdminSection = adminPaths.some((p) => location.pathname.startsWith(p));

  return (
    <div className="admin-menu" ref={ref}>
      <button
        className={`admin-menu-trigger ${open || isInAdminSection ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        Admin
        <span className="chev">▾</span>
      </button>
      {open && (
        <div className="admin-menu-panel">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} onClick={() => setOpen(false)}>
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
