import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchResources, fetchOrganizations, type Organization } from "./api";

interface OrgOption {
  id: string;
  name: string;
}

interface OrgContextValue {
  selected: string | null; // null = "All organizations"
  setSelected: (id: string | null) => void;
  options: OrgOption[];
}

const OrgContext = createContext<OrgContextValue | null>(null);
const STORAGE_KEY = "remotely_selected_org";

export function OrgProvider({ children }: { children: ReactNode }) {
  const [selected, setSelectedState] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY) || null);
  const [options, setOptions] = useState<OrgOption[]>([]);

  useEffect(() => {
    // Derive the switchable org list from whatever's actually visible to
    // this user (works for plain users too) — "client" is the label
    // convention RBAC roles/connections use for org scoping throughout
    // this app. Best-effort enrich with real display names; full-admin-only
    // endpoint, so non-admins silently keep the raw id as the label.
    fetchResources()
      .then((resources) => {
        const ids = Array.from(new Set(resources.map((r) => r.labels.client).filter((v): v is string => Boolean(v))));
        setOptions((prev) => {
          const nameById = new Map(prev.map((o) => [o.id, o.name]));
          return ids.map((id) => ({ id, name: nameById.get(id) ?? id }));
        });
      })
      .catch(() => {});
    fetchOrganizations()
      .then((orgs: Organization[]) => {
        setOptions((prev) => prev.map((o) => ({ ...o, name: orgs.find((org) => org.id === o.id)?.name ?? o.name })));
      })
      .catch(() => {});
  }, []);

  function setSelected(id: string | null) {
    setSelectedState(id);
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }

  return <OrgContext.Provider value={{ selected, setSelected, options }}>{children}</OrgContext.Provider>;
}

export function useOrgFilter() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrgFilter must be used inside OrgProvider");
  return ctx;
}
