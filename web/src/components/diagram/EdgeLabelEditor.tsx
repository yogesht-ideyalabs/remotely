/**
 * Inline editor for edge (connector) labels.
 * Shows when user double-clicks an edge.
 *
 * Author: Yogesh Tiwari
 */

import { useState } from "react";

interface EdgeLabelEditorProps {
  edgeId: string;
  currentLabel: string;
  onSave: (edgeId: string, label: string) => void;
  onCancel: () => void;
}

export function EdgeLabelEditor({ edgeId, currentLabel, onSave, onCancel }: EdgeLabelEditorProps) {
  const [label, setLabel] = useState(currentLabel);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
        <h3>Edit Connection Label</h3>
        <input
          autoFocus
          className="edge-label-input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g., HTTPS, port 443, connects-to..."
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave(edgeId, label);
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className="modal-actions">
          <button className="btn-primary" onClick={() => onSave(edgeId, label)}>
            Save
          </button>
          <button className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
