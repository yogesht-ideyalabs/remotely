import { useOrgFilter } from "./OrgContext";

export default function OrgSwitcher() {
  const { selected, setSelected, options } = useOrgFilter();
  if (options.length === 0) return null;

  return (
    <select value={selected ?? ""} onChange={(e) => setSelected(e.target.value || null)} title="Switch organization">
      <option value="">All organizations</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
