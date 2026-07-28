import { useEffect, useMemo, useState } from "react";
import { fetchAudit, type AuditEvent } from "../api";
import { AUDIT_CATEGORIES, categoryForEventType, toneForEventType } from "../auditCategories";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";

// Full-length UUIDs (connection/diagram/session ids) wrapped to 2-3 lines in
// this column, making every row a different height and the whole table look
// uneven. Short, human-chosen resource ids (hostnames) are left alone —
// only the long generated ones get truncated, with the full value still
// available via the cell's `title` tooltip.
function truncateId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 20 ? `${id.slice(0, 8)}…` : id;
}

export default function Audit() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [eventType, setEventType] = useState("");
  const [userFilter, setUserFilter] = useState("");

  useEffect(() => {
    fetchAudit()
      .then(setEvents)
      .catch((e) => setError(e.message));
  }, []);

  const users = useMemo(() => Array.from(new Set((events ?? []).map((e) => e.username))).sort(), [events]);

  // Only offer event types that both belong to the selected category AND
  // actually occur in this log — an admin picking "Sessions" shouldn't see
  // a dropdown full of event types nothing here ever produced.
  const eventTypesInCategory = useMemo(() => {
    if (!categoryId || !events) return [];
    const present = new Set(events.map((e) => e.eventType));
    const category = AUDIT_CATEGORIES.find((c) => c.id === categoryId);
    return (category?.eventTypes ?? []).filter((t) => present.has(t));
  }, [categoryId, events]);

  const filtered = useMemo(() => {
    if (!events) return null;
    return events.filter((e) => {
      if (categoryId && categoryForEventType(e.eventType).id !== categoryId) return false;
      if (eventType && e.eventType !== eventType) return false;
      if (userFilter && e.username !== userFilter) return false;
      return true;
    });
  }, [events, categoryId, eventType, userFilter]);

  const hasFilters = categoryId || eventType || userFilter;

  return (
    <div>
      <h2 className="page-title">Audit Log</h2>
      <p className="page-sub">
        Structured, append-only event log — every login, denial, and session start/end. Admin-only.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="form-row">
        <select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setEventType("");
          }}
          style={{ width: "auto" }}
        >
          <option value="">All categories</option>
          {AUDIT_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {categoryId && (
          <select value={eventType} onChange={(e) => setEventType(e.target.value)} style={{ width: "auto" }}>
            <option value="">All events in this category</option>
            {eventTypesInCategory.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} style={{ width: "auto" }}>
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            className="link"
            onClick={() => {
              setCategoryId("");
              setEventType("");
              setUserFilter("");
            }}
          >
            clear filters
          </button>
        )}
      </div>

      {events === null && <Skeleton lines={6} />}
      {filtered && filtered.length === 0 && (
        <EmptyState message={events && events.length > 0 ? "No events match these filters." : "No audit events yet."} />
      )}
      {filtered && filtered.length > 0 && (
        <table className="audit-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Category</th>
              <th>Event</th>
              <th>Resource</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.ts).toLocaleString()}</td>
                <td>{e.username}</td>
                <td>
                  <span className="label-chip">{categoryForEventType(e.eventType).label}</span>
                </td>
                <td>
                  <StatusBadge tone={toneForEventType(e.eventType)}>{e.eventType}</StatusBadge>
                </td>
                <td className="truncate-cell" title={e.resourceId ?? undefined}>
                  {truncateId(e.resourceId)}
                </td>
                <td>{e.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
