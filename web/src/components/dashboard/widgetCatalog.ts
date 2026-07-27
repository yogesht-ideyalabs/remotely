/**
 * Curated dashboard widget catalog — a fixed set of real widget types you
 * add/remove/reorder/resize in a responsive grid, not a free-form
 * drag-anywhere canvas (that's a substantially bigger undertaking, closer
 * to the Diagram Editor's own complexity, and was explicitly scoped out).
 *
 * Author: Yogesh Tiwari
 */

import type { DashboardWidgetInstance, WidgetSize } from "../../api";

export type WidgetType =
  | "kpi-resources"
  | "kpi-sessions"
  | "kpi-users"
  | "kpi-agents"
  | "kpi-failed-logins"
  | "chart-activity-24h"
  | "chart-sessions-7d"
  | "resource-breakdown"
  | "recent-denials"
  | "recent-activity"
  | "uptime-summary"
  | "agent-status";

export interface WidgetMeta {
  type: WidgetType;
  label: string;
  description: string;
  icon: string;
  defaultSize: WidgetSize;
}

export const WIDGET_CATALOG: WidgetMeta[] = [
  { type: "kpi-resources", label: "Resource count", description: "Total resources visible to you.", icon: "🖥️", defaultSize: "small" },
  { type: "kpi-sessions", label: "Active sessions", description: "Currently open sessions.", icon: "📡", defaultSize: "small" },
  { type: "kpi-users", label: "User count", description: "Total users in your scope.", icon: "👥", defaultSize: "small" },
  { type: "kpi-agents", label: "Agents online", description: "Connected reverse-tunnel agents.", icon: "💓", defaultSize: "small" },
  { type: "kpi-failed-logins", label: "Failed logins (24h)", description: "Failed login attempts in the last 24 hours.", icon: "⚠️", defaultSize: "small" },
  { type: "chart-activity-24h", label: "Activity — 24h", description: "Stacked bar chart of logins, sessions, and denials by hour.", icon: "📊", defaultSize: "large" },
  { type: "chart-sessions-7d", label: "Sessions — 7 days", description: "Sessions started per day, last 7 days.", icon: "📈", defaultSize: "medium" },
  { type: "resource-breakdown", label: "Resources by type", description: "Bar breakdown of resource types in your scope.", icon: "🗂️", defaultSize: "medium" },
  { type: "recent-denials", label: "Recent access denials", description: "Latest access-denied events.", icon: "🚫", defaultSize: "large" },
  { type: "recent-activity", label: "Recent activity", description: "Latest audit events across your scoped view.", icon: "📜", defaultSize: "large" },
  { type: "uptime-summary", label: "Uptime monitors", description: "Status of your configured uptime monitors.", icon: "🚨", defaultSize: "medium" },
  { type: "agent-status", label: "Agent status", description: "Connected agents and their latency.", icon: "🔌", defaultSize: "medium" },
];

export function widgetMeta(type: string): WidgetMeta | undefined {
  return WIDGET_CATALOG.find((w) => w.type === type);
}

let seq = 0;
export function newWidgetInstance(type: WidgetType): DashboardWidgetInstance {
  seq += 1;
  return { id: `w-${Date.now()}-${seq}`, type, size: widgetMeta(type)?.defaultSize ?? "medium" };
}

export const DEFAULT_WIDGETS: DashboardWidgetInstance[] = [
  { id: "default-1", type: "kpi-resources", size: "small" },
  { id: "default-2", type: "kpi-sessions", size: "small" },
  { id: "default-3", type: "kpi-users", size: "small" },
  { id: "default-4", type: "kpi-agents", size: "small" },
  { id: "default-5", type: "kpi-failed-logins", size: "small" },
  { id: "default-6", type: "chart-activity-24h", size: "large" },
  { id: "default-7", type: "chart-sessions-7d", size: "medium" },
  { id: "default-8", type: "resource-breakdown", size: "medium" },
  { id: "default-9", type: "recent-denials", size: "large" },
];
