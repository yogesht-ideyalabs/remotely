/**
 * Connector (edge) style editor — shows when the user double-clicks an
 * edge. Beyond just the label, this covers the same "connector style"
 * basics draw.io exposes when you select a connector: routing (straight /
 * orthogonal / curved), line style (solid / dashed), and line color.
 *
 * Author: Yogesh Tiwari
 */

import { useEffect, useState } from "react";

export interface EdgeStyleValue {
  label: string;
  routing: "straight" | "step" | "smoothstep" | "bezier";
  dashed: boolean;
  color: string;
}

interface EdgeLabelEditorProps {
  edgeId: string;
  currentValue: EdgeStyleValue;
  onSave: (edgeId: string, value: EdgeStyleValue) => void;
  onCancel: () => void;
}

const ROUTING_OPTIONS: { value: EdgeStyleValue["routing"]; label: string }[] = [
  { value: "smoothstep", label: "Orthogonal (rounded)" },
  { value: "step", label: "Orthogonal (sharp)" },
  { value: "straight", label: "Straight" },
  { value: "bezier", label: "Curved" },
];

const COLOR_PRESETS = ["#8a94a8", "#5b8cff", "#22c55e", "#f59e0b", "#ef4444", "#a855f7"];

export function EdgeLabelEditor({ edgeId, currentValue, onSave, onCancel }: EdgeLabelEditorProps) {
  const [value, setValue] = useState<EdgeStyleValue>(currentValue);

  const save = () => onSave(edgeId, value);

  // Modal-level Escape handling — the label input's own onKeyDown only
  // catches Escape while that specific field is focused, which silently
  // stops working the moment the user clicks the routing dropdown or a
  // color swatch instead.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
        <h3>Edit Connector</h3>
        <label className="edge-editor-field">
          <span>Label</span>
          <input
            autoFocus
            className="edge-label-input"
            value={value.label}
            onChange={(e) => setValue({ ...value, label: e.target.value })}
            placeholder="e.g., HTTPS, port 443, connects-to..."
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") onCancel();
            }}
          />
        </label>

        <label className="edge-editor-field">
          <span>Routing</span>
          <select value={value.routing} onChange={(e) => setValue({ ...value, routing: e.target.value as EdgeStyleValue["routing"] })}>
            {ROUTING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <label className="edge-editor-field edge-editor-checkbox">
          <input
            type="checkbox"
            checked={value.dashed}
            onChange={(e) => setValue({ ...value, dashed: e.target.checked })}
          />
          <span>Dashed line</span>
        </label>

        <div className="edge-editor-field">
          <span>Color</span>
          <div className="edge-color-swatches">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                className={`edge-color-swatch${value.color === c ? " active" : ""}`}
                style={{ background: c }}
                onClick={() => setValue({ ...value, color: c })}
                title={c}
              />
            ))}
            <input
              type="color"
              className="edge-color-custom"
              value={value.color}
              onChange={(e) => setValue({ ...value, color: e.target.value })}
            />
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-primary" onClick={save}>
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
