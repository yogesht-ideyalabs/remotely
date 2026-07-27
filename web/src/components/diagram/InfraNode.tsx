/**
 * Custom node for infrastructure resources on the diagram canvas.
 * Shows an icon, label, and handles for connections.
 *
 * Author: Yogesh Tiwari
 */

import { memo } from "react";
import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { CloudIcon } from "./CloudIcon";

// One handle per side, each usable as BOTH a connection start and end (not
// source-only/target-only) — every side needs its own `id` because xyflow's
// addEdge() de-dupes new connections by (source, target, sourceHandle,
// targetHandle); without distinct ids every handle on a node resolves to the
// same (node, undefined) pair, so a second wire between the same two nodes
// (even from a different side) was silently dropped as a "duplicate" of the
// first. Confirmed live: before this fix, only ever one edge could exist
// between any given pair of nodes, no matter which handle you dragged from.
const HANDLE_SIDES = [
  { id: "top", position: Position.Top },
  { id: "right", position: Position.Right },
  { id: "bottom", position: Position.Bottom },
  { id: "left", position: Position.Left },
] as const;

interface InfraNodeData {
  label: string;
  icon: string;
  provider?: string;
  resourceType?: string;
  color?: string;
  locked?: boolean;
  customImage?: string;
  [key: string]: unknown;
}

export const InfraNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as InfraNodeData;
  const accent = nodeData.color || "#5b8cff";

  return (
    <div
      className={`infra-node${selected ? " infra-node-selected" : ""}${nodeData.locked ? " infra-node-locked" : ""}`}
      style={{ ["--node-accent" as string]: accent }}
    >
      <NodeResizer isVisible={selected} minWidth={140} minHeight={50} lineClassName="infra-resize-line" handleClassName="infra-resize-handle" />

      {HANDLE_SIDES.map((side) => (
        <Handle
          key={side.id}
          id={side.id}
          type="source"
          position={side.position}
          isConnectableStart
          isConnectableEnd
          className="infra-handle"
        />
      ))}

      {nodeData.customImage ? (
        <div className="cloud-icon-badge" style={{ width: 32, height: 32 }}>
          <img className="cloud-icon-custom-img" src={nodeData.customImage} alt="" />
        </div>
      ) : (
        <CloudIcon provider={nodeData.provider} resourceType={nodeData.resourceType} fallbackEmoji={nodeData.icon} accent={accent} size={32} />
      )}
      <div className="infra-node-text">
        <div className="infra-node-label">{nodeData.label}</div>
        {nodeData.resourceType && (
          <div className="infra-node-type">{nodeData.resourceType}</div>
        )}
      </div>
      {nodeData.locked && <span className="infra-node-lock" title="Locked">🔒</span>}
    </div>
  );
});

InfraNode.displayName = "InfraNode";
