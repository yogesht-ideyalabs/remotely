/**
 * Infrastructure Snapshots — point-in-time captures for versioning and
 * diff. The backend (infraSnapshots.ts: takeSnapshot/listSnapshots/
 * diffSnapshots/deleteSnapshot, real routes under /api/infra/snapshots)
 * had been fully built with no UI anywhere to actually use it — this page
 * is that missing UI, not a new feature.
 *
 * Author: Yogesh Tiwari
 */

import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { apiFetch } from "../api";
import { FieldLabel } from "../components/FieldLabel";
import { EmptyState } from "../components/EmptyState";
import { Skeleton } from "../components/Skeleton";

interface SnapshotMeta {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  createdBy: string;
  resourceCount: number;
}

interface SnapshotResource {
  externalId: string;
  provider: string;
  region: string;
  type: string;
  name: string;
  propsHash: string;
  keyProps: Record<string, unknown>;
}

interface SnapshotDiff {
  fromSnapshot: { id: string; name: string; createdAt: number };
  toSnapshot: { id: string; name: string; createdAt: number };
  added: SnapshotResource[];
  removed: SnapshotResource[];
  modified: { resource: SnapshotResource; previousProps: Record<string, unknown> }[];
  unchanged: number;
}

function formatProps(props: Record<string, unknown>): string {
  const entries = Object.entries(props);
  if (entries.length === 0) return "—";
  return entries.map(([k, v]) => `${k}=${v}`).join(", ");
}

export default function Snapshots() {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("current");
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [diffing, setDiffing] = useState(false);

  const load = () => {
    apiFetch("/api/infra/snapshots")
      .then((list: SnapshotMeta[]) => {
        setSnapshots(list);
        if (list.length > 0 && !fromId) setFromId(list[list.length - 1].id);
      })
      .catch((err) => setError((err as Error).message));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const take = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch("/api/infra/snapshots", { method: "POST", body: JSON.stringify({ name, description }) });
      setName("");
      setDescription("");
      setCreating(false);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this snapshot? This cannot be undone.")) return;
    try {
      await apiFetch(`/api/infra/snapshots/${id}`, { method: "DELETE" });
      if (diff && (diff.fromSnapshot.id === id || diff.toSnapshot.id === id)) setDiff(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const compare = async () => {
    if (!fromId) return;
    setDiffing(true);
    setError("");
    try {
      const result = await apiFetch(`/api/infra/snapshots/${fromId}/diff/${toId}`);
      setDiff(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDiffing(false);
    }
  };

  return (
    <div className="page infra-map-page">
      <div className="page-header">
        <h1><Icon name="camera" size={22} /> Infrastructure Snapshots</h1>
        <p className="subtitle">
          Point-in-time captures of everything discovered — take one before a big change, then diff it against
          another snapshot or live infrastructure to see exactly what was added, removed, or modified.
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="infra-section">
        <div className="section-header">
          <h2>Snapshots</h2>
          <button className="btn-primary" onClick={() => setCreating((c) => !c)}>
            + Take Snapshot
          </button>
        </div>

        {creating && (
          <div className="add-account-form" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <FieldLabel label="Name">A short label for this point in time — e.g. "pre-migration" or "2026-Q3 baseline".</FieldLabel>
              <input placeholder="e.g. pre-migration baseline" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <FieldLabel label="Description (optional)">Any extra context worth remembering later about why this snapshot was taken.</FieldLabel>
              <input placeholder="optional notes" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="form-actions">
              <button className="btn-primary" onClick={take} disabled={saving || !name.trim()}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </div>
        )}

        {snapshots === null ? (
          <Skeleton lines={3} />
        ) : snapshots.length === 0 ? (
          <EmptyState
            icon="camera"
            message="No snapshots yet — take one to start tracking infrastructure changes over time."
            action={{ label: "+ Take Snapshot", onClick: () => setCreating(true) }}
          />
        ) : (
          <div className="accounts-list">
            {snapshots.map((s) => (
              <div key={s.id} className="account-card">
                <div className="account-info">
                  <span className="account-icon"><Icon name="camera" size={16} /></span>
                  <div>
                    <strong>{s.name}</strong>
                    <div className="account-meta">
                      {s.resourceCount} resources • {s.createdBy} • {new Date(s.createdAt).toLocaleString()}
                    </div>
                    {s.description && <div className="account-sync">{s.description}</div>}
                  </div>
                </div>
                <div className="account-actions">
                  <button className="btn-sm btn-danger" onClick={() => remove(s.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {snapshots && snapshots.length > 0 && (
        <div className="infra-section">
          <h2>Compare</h2>
          <div className="diagram-controls">
            <label>
              From:
              <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({new Date(s.createdAt).toLocaleDateString()})</option>
                ))}
              </select>
            </label>
            <label>
              To:
              <select value={toId} onChange={(e) => setToId(e.target.value)}>
                <option value="current">Live Infrastructure (now)</option>
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({new Date(s.createdAt).toLocaleDateString()})</option>
                ))}
              </select>
            </label>
            <button className="btn-primary" onClick={compare} disabled={diffing}>
              {diffing ? "Comparing…" : "Compare"}
            </button>
          </div>
        </div>
      )}

      {diff && (
        <div className="infra-section">
          <h2>
            {diff.fromSnapshot.name} → {diff.toSnapshot.name}
          </h2>
          <div className="infra-summary-grid">
            <div className="summary-card">
              <div className="card-value" style={{ color: "var(--ok, #22c55e)" }}>{diff.added.length}</div>
              <div className="card-label">Added</div>
            </div>
            <div className="summary-card">
              <div className="card-value" style={{ color: "var(--danger)" }}>{diff.removed.length}</div>
              <div className="card-label">Removed</div>
            </div>
            <div className="summary-card">
              <div className="card-value" style={{ color: "var(--accent)" }}>{diff.modified.length}</div>
              <div className="card-label">Modified</div>
            </div>
            <div className="summary-card">
              <div className="card-value">{diff.unchanged}</div>
              <div className="card-label">Unchanged</div>
            </div>
          </div>

          {diff.added.length > 0 && (
            <div className="infra-breakdown">
              <div className="breakdown-section">
                <h3>Added</h3>
                <div className="accounts-list">
                  {diff.added.map((r) => (
                    <div key={r.externalId} className="account-card">
                      <div className="account-info">
                        <div>
                          <strong>{r.name}</strong>
                          <div className="account-meta">{r.provider} • {r.type} • {r.region}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {diff.removed.length > 0 && (
            <div className="infra-breakdown">
              <div className="breakdown-section">
                <h3>Removed</h3>
                <div className="accounts-list">
                  {diff.removed.map((r) => (
                    <div key={r.externalId} className="account-card">
                      <div className="account-info">
                        <div>
                          <strong>{r.name}</strong>
                          <div className="account-meta">{r.provider} • {r.type} • {r.region}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {diff.modified.length > 0 && (
            <div className="infra-breakdown">
              <div className="breakdown-section">
                <h3>Modified</h3>
                <div className="accounts-list">
                  {diff.modified.map(({ resource, previousProps }) => (
                    <div key={resource.externalId} className="account-card">
                      <div className="account-info">
                        <div>
                          <strong>{resource.name}</strong>
                          <div className="account-meta">{resource.provider} • {resource.type} • {resource.region}</div>
                          <div className="account-sync">
                            was: {formatProps(previousProps)}
                            <br />
                            now: {formatProps(resource.keyProps)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
