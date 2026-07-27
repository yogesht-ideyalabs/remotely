/**
 * Multi-page diagram tabs — draw.io places these along the bottom of the
 * canvas (spreadsheet-style), one page per real-world layer of the
 * architecture (e.g. "Network," "Data Flow," "DR Region"). Each page is a
 * fully independent nodes/edges set; only the active page is live in
 * React Flow's own state at any moment (see DiagramEditor.tsx's
 * `switchPage`), the rest sit in `pages` as plain snapshots.
 *
 * Author: Yogesh Tiwari
 */

interface PageTabsProps {
  pages: { id: string; name: string }[];
  activePageId: string;
  onSwitch: (pageId: string) => void;
  onAdd: () => void;
  onRename: (pageId: string) => void;
  onDelete: (pageId: string) => void;
}

export function PageTabs({ pages, activePageId, onSwitch, onAdd, onRename, onDelete }: PageTabsProps) {
  return (
    <div className="page-tabs">
      {pages.map((p) => (
        <button
          key={p.id}
          className={`page-tab${p.id === activePageId ? " active" : ""}`}
          onClick={() => onSwitch(p.id)}
          onDoubleClick={() => onRename(p.id)}
          title="Click to switch, double-click to rename"
        >
          {p.name}
          {pages.length > 1 && (
            <span
              className="page-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(p.id);
              }}
              title="Delete page"
            >
              ✕
            </span>
          )}
        </button>
      ))}
      <button className="page-tab-add" onClick={onAdd} title="Add page">
        +
      </button>
    </div>
  );
}
