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
}

export function DiagramToolbar({
  diagramName,
  onNameChange,
  onSave,
  onLoad,
  onExportJSON,
  onExportPNG,
  onExportPDF,
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
      </div>

      <div className="toolbar-right">
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
