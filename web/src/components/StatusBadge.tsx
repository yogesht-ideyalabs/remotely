import type { ReactNode } from "react";

export type StatusTone = "ok" | "warn" | "danger" | "accent" | "neutral";

// Status is encoded in shape (dot + pill) as well as color, so it still
// reads for anyone who can't distinguish the hues apart.
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`status-badge status-badge-${tone}`}>
      <span className="status-badge-dot" />
      {children}
    </span>
  );
}
