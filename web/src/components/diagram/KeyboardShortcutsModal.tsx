/**
 * "?" shortcuts reference — draw.io ships an identical modal (Help >
 * Keyboard Shortcuts). Listing these matters once a canvas has this many
 * non-obvious keybindings; without it, most of them would just never be
 * discovered.
 *
 * Author: Yogesh Tiwari
 */

import { useEffect } from "react";

const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");
const mod = isMac ? "⌘" : "Ctrl";

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: `${mod}+Z`, action: "Undo" },
  { keys: `${mod}+Shift+Z`, action: "Redo" },
  { keys: `${mod}+C`, action: "Copy selected shapes" },
  { keys: `${mod}+V`, action: "Paste" },
  { keys: `${mod}+D`, action: "Duplicate selected shapes" },
  { keys: "Delete / Backspace", action: "Delete selected shapes or connectors" },
  { keys: `${mod}+A`, action: "Select all" },
  { keys: "Shift + click", action: "Add/remove a shape from the selection" },
  { keys: "Drag on empty canvas", action: "Rubber-band select multiple shapes" },
  { keys: "Double-click a connector", action: "Edit label, routing, style, color" },
  { keys: "Right-click", action: "Context menu (copy, paste, duplicate, order, delete)" },
  { keys: "Escape", action: "Deselect / close panel" },
];

export function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  // Self-contained Escape handling — this modal has no focused input for a
  // keydown handler to piggyback on (unlike EdgeLabelEditor's label field),
  // so without this, Escape does nothing and only the Close button works.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Keyboard Shortcuts</h3>
        <table className="shortcuts-table">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.action}>
                <td><kbd>{s.keys}</kbd></td>
                <td>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
