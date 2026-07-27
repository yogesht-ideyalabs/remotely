/**
 * Toolbar for the diagram editor — save, load, export, import, delete.
 *
 * Author: Yogesh Tiwari
 */

import { useRef, useState } from "react";
import { useDismiss } from "../../useDismiss";

export interface SaveStatus {
  state: "idle" | "saving" | "saved" | "error";
  message?: string;
  at?: number;
}

interface DiagramToolbarProps {
  diagramName: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  saveStatus: SaveStatus;
  onLoad: () => void;
  onExportJSON: () => void;
  onExportPNG: () => void;
  onExportSVG: () => void;
  onExportPDF: () => void;
  onExportMermaid: () => void;
  onExportCSV: () => void;
  onExportHTML: () => void;
  onImportDiscovery: () => void;
  onAutoLayout: () => void;
  onClear: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  onShowShortcuts: () => void;
  onShare: () => void;
  shareDisabled: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

function SaveStatusPill({ status }: { status: SaveStatus }) {
  if (status.state === "saving") return <span className="save-status save-status-saving">Saving…</span>;
  if (status.state === "saved") return <span className="save-status save-status-saved">✓ Saved</span>;
  if (status.state === "error")
    return (
      <span className="save-status save-status-error" title={status.message}>
        ⚠ Save failed{status.message ? `: ${status.message}` : ""}
      </span>
    );
  return null;
}

export function DiagramToolbar({
  diagramName,
  onNameChange,
  onSave,
  saveStatus,
  onLoad,
  onExportJSON,
  onExportPNG,
  onExportSVG,
  onExportPDF,
  onExportMermaid,
  onExportCSV,
  onExportHTML,
  onImportDiscovery,
  onAutoLayout,
  onClear,
  onDelete,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onCopy,
  onPaste,
  onDuplicate,
  onShowShortcuts,
  onShare,
  shareDisabled,
  isFullscreen,
  onToggleFullscreen,
}: DiagramToolbarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  useDismiss(exportRef, exportOpen, () => setExportOpen(false));

  const exportItems: { label: string; onClick: () => void; ext: string }[] = [
    { label: "JSON — raw diagram data", onClick: onExportJSON, ext: ".json" },
    { label: "PNG — raster image", onClick: onExportPNG, ext: ".png" },
    { label: "SVG — vector image", onClick: onExportSVG, ext: ".svg" },
    { label: "PDF — printable document", onClick: onExportPDF, ext: ".pdf" },
    { label: "Mermaid — diagram source", onClick: onExportMermaid, ext: ".mmd" },
    { label: "CSV — resource inventory", onClick: onExportCSV, ext: ".csv" },
    { label: "HTML — standalone page", onClick: onExportHTML, ext: ".html" },
  ];

  return (
    <div className="diagram-toolbar">
      <div className="toolbar-left">
        <input
          className="diagram-name-input"
          value={diagramName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Diagram name..."
        />
      </div>

      <div className="toolbar-center">
        <button className="toolbar-btn" onClick={onSave} title="Save diagram to your Remotely account">
          💾 Save
        </button>
        <SaveStatusPill status={saveStatus} />
        <button className="toolbar-btn" onClick={onLoad} title="Open a diagram you've saved before">
          📂 Load
        </button>
        <div className="toolbar-divider" />
        <button className="toolbar-btn toolbar-btn-icon" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↩️
        </button>
        <button className="toolbar-btn toolbar-btn-icon" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          ↪️
        </button>
        <div className="toolbar-divider" />
        <button className="toolbar-btn toolbar-btn-icon" onClick={onCopy} title="Copy selected (Ctrl+C)">
          📋
        </button>
        <button className="toolbar-btn toolbar-btn-icon" onClick={onPaste} title="Paste (Ctrl+V)">
          📌
        </button>
        <button className="toolbar-btn toolbar-btn-icon" onClick={onDuplicate} title="Duplicate selected (Ctrl+D)">
          🧬
        </button>
        <div className="toolbar-divider" />
        <button className="toolbar-btn toolbar-btn-icon" onClick={onImportDiscovery} title="Import from infrastructure discovery">
          🔍
        </button>
        <button className="toolbar-btn toolbar-btn-icon" onClick={onAutoLayout} title="Automatically arrange nodes (dagre hierarchical layout)">
          🧭
        </button>
        <div className="toolbar-divider" />
        <div className="toolbar-dropdown" ref={exportRef}>
          <button className="toolbar-btn" onClick={() => setExportOpen((o) => !o)} title="Export the diagram">
            ⬇️ Export ▾
          </button>
          {exportOpen && (
            <div className="toolbar-dropdown-panel">
              {exportItems.map((item) => (
                <button
                  key={item.ext}
                  className="toolbar-dropdown-item"
                  onClick={() => {
                    item.onClick();
                    setExportOpen(false);
                  }}
                >
                  <span className="toolbar-dropdown-ext">{item.ext}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="toolbar-right">
        <button
          className="toolbar-btn toolbar-btn-icon"
          onClick={onToggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Maximize the canvas to fill your screen"}
        >
          {isFullscreen ? "🡼" : "⛶"}
        </button>
        <button
          className="toolbar-btn toolbar-btn-icon"
          onClick={onShare}
          disabled={shareDisabled}
          title={shareDisabled ? "Save the diagram first to share it" : "Get a read-only public link (no login required)"}
        >
          🔗
        </button>
        <button className="toolbar-btn toolbar-btn-icon" onClick={onShowShortcuts} title="Keyboard shortcuts (?)">
          ⌨️
        </button>
        <div className="toolbar-divider" />
        <button className="toolbar-btn toolbar-btn-icon toolbar-btn-danger" onClick={onDelete} title="Delete selected">
          🗑️
        </button>
        <button className="toolbar-btn toolbar-btn-icon toolbar-btn-danger" onClick={onClear} title="Clear canvas">
          ✖️
        </button>
      </div>
    </div>
  );
}
