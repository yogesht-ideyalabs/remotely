/**
 * Renders a labels/tags object as chips — `key=value` pills, the same
 * pattern Resources.tsx already used for connection labels. Several other
 * admin tables (Connections, Roles' allow/deny, Agent Health) were instead
 * dumping the raw `{"client":"acme-corp",...}` JSON straight into a table
 * cell, which reads as unfinished/internal-tool rather than something
 * meant for a real admin to scan at a glance.
 *
 * Author: Yogesh Tiwari
 */
export function LabelChips({ labels }: { labels: Record<string, unknown> | null | undefined }) {
  const entries = Object.entries(labels ?? {});
  if (entries.length === 0) return <span className="text-dim">—</span>;
  return (
    <div className="labels">
      {entries.map(([k, v]) => (
        <span className="label-chip" key={k}>
          {k}={Array.isArray(v) ? v.join(",") : String(v)}
        </span>
      ))}
    </div>
  );
}
