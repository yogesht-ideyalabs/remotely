import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchRecordings, deleteRecordingApi, type RecordingMeta } from "../api";

export default function Recordings() {
  const [recordings, setRecordings] = useState<RecordingMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resourceFilter, setResourceFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");

  function load() {
    fetchRecordings()
      .then(setRecordings)
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  const { resources, users } = useMemo(() => {
    const resources = new Set<string>();
    const users = new Set<string>();
    for (const r of recordings ?? []) {
      resources.add(r.resource);
      users.add(r.username);
    }
    return { resources: Array.from(resources).sort(), users: Array.from(users).sort() };
  }, [recordings]);

  const filtered = useMemo(() => {
    if (!recordings) return null;
    return recordings.filter((r) => {
      if (resourceFilter && r.resource !== resourceFilter) return false;
      if (userFilter && r.username !== userFilter) return false;
      if (after && r.modifiedAt < new Date(after).getTime()) return false;
      if (before && r.modifiedAt > new Date(before).getTime() + 86400000) return false;
      return true;
    });
  }, [recordings, resourceFilter, userFilter, after, before]);

  function toggleSelected(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!filtered) return;
    setSelected((s) => (s.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.sessionId))));
  }

  async function remove(sessionId: string) {
    if (!confirm(`Delete recording "${sessionId}"? This can't be undone.`)) return;
    try {
      await deleteRecordingApi(sessionId);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} selected recording(s)? This can't be undone.`)) return;
    setError(null);
    try {
      await Promise.all(Array.from(selected).map((id) => deleteRecordingApi(id)));
      setSelected(new Set());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "bulk delete failed");
    }
  }

  return (
    <div>
      <h2 className="page-title">Session Recordings</h2>
      <p className="page-sub">
        Every session — SSH, RDP, and database — is captured with timing and fully replayable below. Filter and
        clean up what you don't need.
      </p>
      {error && <div className="error-banner">{error}</div>}

      <div className="form-row">
        <select value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)} style={{ width: "auto" }}>
          <option value="">All resources</option>
          {resources.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} style={{ width: "auto" }}>
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <div>
          <div className="hint">from</div>
          <input type="date" value={after} onChange={(e) => setAfter(e.target.value)} style={{ width: "auto" }} />
        </div>
        <div>
          <div className="hint">to</div>
          <input type="date" value={before} onChange={(e) => setBefore(e.target.value)} style={{ width: "auto" }} />
        </div>
        {(resourceFilter || userFilter || after || before) && (
          <button
            className="link"
            onClick={() => {
              setResourceFilter("");
              setUserFilter("");
              setAfter("");
              setBefore("");
            }}
          >
            clear filters
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="section-card" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <b style={{ fontSize: 12 }}>{selected.size} selected</b>
          <button className="danger-link" onClick={bulkDelete}>
            Delete selected
          </button>
          <button className="link" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {filtered && filtered.length === 0 && (
        <div className="empty-state">
          {recordings && recordings.length > 0 ? "No recordings match these filters." : "No recordings yet — connect to a resource first."}
        </div>
      )}
      {filtered && filtered.length > 0 && (
        <table className="audit-table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={selected.size > 0 && selected.size === filtered.length} onChange={toggleSelectAll} style={{ width: "auto" }} />
              </th>
              <th>Session</th>
              <th>Resource</th>
              <th>Type</th>
              <th>User</th>
              <th>Size</th>
              <th>Recorded</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.sessionId}>
                <td>
                  <input type="checkbox" checked={selected.has(r.sessionId)} onChange={() => toggleSelected(r.sessionId)} style={{ width: "auto" }} />
                </td>
                <td>{r.sessionId}</td>
                <td>{r.resource}</td>
                <td>
                  <span className="label-chip">{r.type}</span>
                </td>
                <td>{r.username}</td>
                <td>{(r.sizeBytes / 1024).toFixed(1)} KB</td>
                <td>{new Date(r.modifiedAt).toLocaleString()}</td>
                <td>
                  <Link to={`/recordings/${r.sessionId}`}>replay →</Link>
                  <button className="danger-link" style={{ marginLeft: 10 }} onClick={() => remove(r.sessionId)}>
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
