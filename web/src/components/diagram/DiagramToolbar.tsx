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
  onExportSVG: () => void;
  onImportDiscovery: () => void;
  onClear: () => void;
  onDelete: () => void;
}

export function DiagramToolbar({
  diagramName,
  onNameChange,
  onSave,
  onLoad,
  onExportJSON,
  onExportSVG,
  onImportDiscovery,
  onClear,
  onDelete,
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
        <button className="toolbar-btn" onClick={onImportDiscovery} title="Import from infrastructure discovery">
          🔍 Import from Discovery
        </button>
        <div className="toolbar-divider" />
        <button className="toolbar-btn" onClick={onExportJSON} title="Export as JSON">
          📄 JSON
        </button>
        <button className="toolbar-btn" onClick={onExportSVG} title="Export as SVG">
          🖼️ SVG
        </button>
      </div>

      <div className="toolbar-right">
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
