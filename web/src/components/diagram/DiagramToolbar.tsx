/**
 * Toolbar for the diagram editor — save, load, export, import, delete.
 *
 * Author: Yogesh Tiwari
 */

interface DiagramToolbarProps {
  diagramName: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onLoad: () => void;
  onExportJSON: () => void;
  onExportPNG: () => void;
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
}

export function DiagramToolbar({
  diagramName,
  onNameChange,
  onSave,
  onLoad,
  onExportJSON,
  onExportPNG,
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
}: DiagramToolbarProps) {
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
        <button className="toolbar-btn" onClick={onSave} title="Save diagram">
          💾 Save
        </button>
        <button className="toolbar-btn" onClick={onLoad} title="Load a saved diagram">
          📂 Load
        </button>
        <div className="toolbar-divider" />
        <button className="toolbar-btn" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↩️ Undo
        </button>
        <button className="toolbar-btn" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          ↪️ Redo
        </button>
        <div className="toolbar-divider" />
        <button className="toolbar-btn" onClick={onCopy} title="Copy selected (Ctrl+C)">
          📋 Copy
        </button>
        <button className="toolbar-btn" onClick={onPaste} title="Paste (Ctrl+V)">
          📌 Paste
        </button>
        <button className="toolbar-btn" onClick={onDuplicate} title="Duplicate selected (Ctrl+D)">
          🧬 Duplicate
        </button>
        <div className="toolbar-divider" />
        <button className="toolbar-btn" onClick={onImportDiscovery} title="Import from infrastructure discovery">
          🔍 Import from Discovery
        </button>
        <button className="toolbar-btn" onClick={onAutoLayout} title="Automatically arrange nodes (dagre hierarchical layout)">
          🧭 Auto-layout
        </button>
        <div className="toolbar-divider" />
        <button className="toolbar-btn" onClick={onExportJSON} title="Export as JSON">
          📄 JSON
        </button>
        <button className="toolbar-btn" onClick={onExportPNG} title="Export as PNG image">
          🖼️ PNG
        </button>
        <button className="toolbar-btn" onClick={onExportPDF} title="Export as PDF">
          📑 PDF
        </button>
        <button className="toolbar-btn" onClick={onExportMermaid} title="Export as Mermaid diagram source">
          🧜 Mermaid
        </button>
        <button className="toolbar-btn" onClick={onExportCSV} title="Export resource inventory as CSV">
          📊 CSV
        </button>
        <button className="toolbar-btn" onClick={onExportHTML} title="Export as a self-contained HTML file">
          🌐 HTML
        </button>
      </div>

      <div className="toolbar-right">
        <button
          className="toolbar-btn"
          onClick={onShare}
          disabled={shareDisabled}
          title={shareDisabled ? "Save the diagram first to share it" : "Get a read-only public link (no login required)"}
        >
          🔗 Share
        </button>
        <button className="toolbar-btn" onClick={onShowShortcuts} title="Keyboard shortcuts (?)">
          ⌨️ Shortcuts
        </button>
        <button className="toolbar-btn toolbar-btn-danger" onClick={onDelete} title="Delete selected">
          🗑️ Delete
        </button>
        <button className="toolbar-btn toolbar-btn-danger" onClick={onClear} title="Clear canvas">
          ✖️ Clear
        </button>
      </div>
    </div>
  );
}
