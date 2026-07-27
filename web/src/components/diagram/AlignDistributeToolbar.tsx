/**
 * Floating align/distribute toolbar — appears whenever 2+ shapes are
 * selected, the same contextual pattern draw.io/Lucidchart use instead of
 * permanent toolbar buttons that only apply to a multi-selection.
 *
 * Author: Yogesh Tiwari
 */

export type AlignEdge = "left" | "centerH" | "right" | "top" | "middle" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

interface AlignDistributeToolbarProps {
  selectedCount: number;
  onAlign: (edge: AlignEdge) => void;
  onDistribute: (axis: DistributeAxis) => void;
}

export function AlignDistributeToolbar({ selectedCount, onAlign, onDistribute }: AlignDistributeToolbarProps) {
  if (selectedCount < 2) return null;

  return (
    <div className="align-toolbar">
      <span className="align-toolbar-count">{selectedCount} selected</span>
      <div className="align-toolbar-group">
        <button title="Align left" onClick={() => onAlign("left")}>⫷</button>
        <button title="Align center" onClick={() => onAlign("centerH")}>┃</button>
        <button title="Align right" onClick={() => onAlign("right")}>⫸</button>
      </div>
      <div className="align-toolbar-group">
        <button title="Align top" onClick={() => onAlign("top")}>⎴</button>
        <button title="Align middle" onClick={() => onAlign("middle")}>—</button>
        <button title="Align bottom" onClick={() => onAlign("bottom")}>⎵</button>
      </div>
      {selectedCount >= 3 && (
        <div className="align-toolbar-group">
          <button title="Distribute horizontally" onClick={() => onDistribute("horizontal")}>⇔</button>
          <button title="Distribute vertically" onClick={() => onDistribute("vertical")}>⇕</button>
        </div>
      )}
    </div>
  );
}
