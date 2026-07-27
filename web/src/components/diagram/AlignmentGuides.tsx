/**
 * Live "smart" alignment guide lines — the pink lines draw.io/Figma/Lucidchart
 * show while dragging a shape near another shape's edge or center. Pure
 * rendering: `DiagramEditor.tsx`'s `onNodeDrag` computes which guide
 * positions are active (and snaps the dragged node to them); this just
 * converts those flow-space positions to screen pixels via the current
 * pan/zoom and draws them.
 *
 * Author: Yogesh Tiwari
 */

import { useViewport } from "@xyflow/react";

interface AlignmentGuidesProps {
  vertical: number[];
  horizontal: number[];
}

export function AlignmentGuides({ vertical, horizontal }: AlignmentGuidesProps) {
  const { x: vpX, y: vpY, zoom } = useViewport();
  if (vertical.length === 0 && horizontal.length === 0) return null;

  return (
    <div className="alignment-guides">
      {vertical.map((flowX, i) => (
        <div key={`v-${i}`} className="alignment-guide-line vertical" style={{ left: flowX * zoom + vpX }} />
      ))}
      {horizontal.map((flowY, i) => (
        <div key={`h-${i}`} className="alignment-guide-line horizontal" style={{ top: flowY * zoom + vpY }} />
      ))}
    </div>
  );
}
