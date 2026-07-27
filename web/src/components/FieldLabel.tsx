import type { ReactNode } from "react";

/**
 * Hover/focus-triggered explanation for a form field — what it means, what
 * format it expects, and where to actually find the value if it comes from
 * somewhere else (a cloud console, a teammate, an existing config). A
 * one-line placeholder isn't enough for fields with real consequences if
 * you guess wrong.
 *
 * Originally local to Roles.tsx (every field there is a real permission
 * dimension); extracted here so every other admin form can reuse the same
 * pattern instead of re-inventing it.
 *
 * Author: Yogesh Tiwari
 */
export function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field-label">
      <span>{label}</span>
      <span className="field-tip" tabIndex={0}>
        <span className="field-tip-icon">i</span>
        <span className="field-tip-popover">{children}</span>
      </span>
    </div>
  );
}
