import type { ReactNode } from "react";
import { Icon } from "../Icon";

export function EmptyState({
  icon = "inbox",
  message,
  action,
}: {
  icon?: string;
  message: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="empty">
      <Icon name={icon} size={22} style={{ opacity: 0.6, marginBottom: 8 }} />
      <p>{message}</p>
      {action && (
        <div style={{ marginTop: 8 }}>
          <button type="button" className="link" onClick={action.onClick}>
            {action.label}
          </button>
        </div>
      )}
    </div>
  );
}
