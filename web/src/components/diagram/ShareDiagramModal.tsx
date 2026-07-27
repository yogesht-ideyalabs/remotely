/**
 * Public share-link modal — generates/shows/revokes the read-only, no-login
 * link for the currently open diagram. Modeled on Scanopy's shareable
 * topology links: hand this URL to a stakeholder who doesn't have (and
 * shouldn't need) a Remotely account, and it stays live as the diagram
 * changes since it always reads the current saved state, not a snapshot.
 *
 * Author: Yogesh Tiwari
 */

import { useState } from "react";
import { apiFetch } from "../../api";

interface ShareDiagramModalProps {
  diagramId: string;
  existingToken: string | undefined;
  onClose: () => void;
  onTokenChange: (token: string | undefined) => void;
}

export function ShareDiagramModal({ diagramId, existingToken, onClose, onTokenChange }: ShareDiagramModalProps) {
  const [token, setToken] = useState(existingToken);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const shareUrl = token ? `${window.location.origin}/share/${token}` : null;

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiFetch(`/api/infra/diagrams/${diagramId}/share`, { method: "POST" });
      setToken(result.token);
      onTokenChange(result.token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const revoke = async () => {
    if (!confirm("Revoke this share link? Anyone with the old URL will lose access immediately.")) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch(`/api/infra/diagrams/${diagramId}/share`, { method: "DELETE" });
      setToken(undefined);
      onTokenChange(undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy automatically — select and copy the link manually.");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
        <h3>Share Diagram</h3>
        {error && <div className="error-banner">{error}</div>}
        <p className="text-dim" style={{ fontSize: 12, marginTop: 0 }}>
          Anyone with this link can view (but not edit) this diagram — no Remotely account required. It always
          shows the current saved version, and stops working the moment you revoke it.
        </p>

        {shareUrl ? (
          <>
            <div className="share-link-row">
              <input readOnly value={shareUrl} onClick={(e) => (e.target as HTMLInputElement).select()} />
              <button className="btn-sm" onClick={copy}>{copied ? "✅ Copied" : "📋 Copy"}</button>
            </div>
            <div className="modal-actions">
              <button className="btn-danger" disabled={loading} onClick={revoke}>
                {loading ? "Revoking…" : "Revoke link"}
              </button>
              <button className="btn-secondary" onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <div className="modal-actions">
            <button className="btn-primary" disabled={loading} onClick={generate}>
              {loading ? "Generating…" : "Generate public link"}
            </button>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
