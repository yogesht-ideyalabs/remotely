/**
 * Version history modal for a saved diagram — every manual save keeps a
 * snapshot of whatever it replaced (see control-plane/src/diagramStore.ts),
 * so this lists past versions and lets the user restore any of them.
 * Restoring is itself a save, so it doesn't erase anything newer — it just
 * appends one more version whose content matches the one restored.
 *
 * Author: Yogesh Tiwari
 */

import { useEffect, useState } from "react";
import { apiFetch } from "../../api";

interface VersionMeta {
  id: string;
  versionNumber: number;
  name: string;
  savedAt: number;
  savedBy: string;
  nodeCount: number;
}

interface DiagramVersionHistoryProps {
  diagramId: string;
  diagramName: string;
  onClose: () => void;
  onRestored: () => void;
}

export function DiagramVersionHistory({ diagramId, diagramName, onClose, onRestored }: DiagramVersionHistoryProps) {
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(`/api/infra/diagrams/${diagramId}/versions`)
      .then(setVersions)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [diagramId]);

  const restore = async (versionId: string) => {
    if (!confirm("Restore this version? Your current content will be saved as a new version first, so nothing is lost.")) return;
    setRestoringId(versionId);
    try {
      await apiFetch(`/api/infra/diagrams/${diagramId}/versions/${versionId}/restore`, { method: "POST" });
      onRestored();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Version History — {diagramName}</h3>
        {error && <div className="error-banner">{error}</div>}
        {loading ? (
          <p className="empty-state">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="empty-state">No prior versions yet — history starts building the next time this diagram is saved over an existing one.</p>
        ) : (
          <div className="diagram-list">
            {versions.map((v) => (
              <div key={v.id} className="version-row">
                <div>
                  <strong>Version {v.versionNumber}</strong>
                  <span className="diagram-list-meta">
                    {new Date(v.savedAt).toLocaleString()} · {v.savedBy} · {v.nodeCount} nodes
                  </span>
                </div>
                <button className="btn-secondary" disabled={restoringId === v.id} onClick={() => restore(v.id)}>
                  {restoringId === v.id ? "Restoring…" : "Restore"}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
