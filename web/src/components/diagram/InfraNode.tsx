/**
 * Custom node for infrastructure resources on the diagram canvas.
 * Shows an icon, label, and handles for connections.
 *
 * Author: Yogesh Tiwari
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

interface InfraNodeData {
  label: string;
  icon: string;
  provider?: string;
  resourceType?: string;
  color?: string;
  [key: string]: unknown;
}

export const InfraNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as InfraNodeData;
  const borderColor = selected ? "#5b8cff" : (nodeData.color || "#3a4050");

  return (
    <div
      className="infra-node"
      style={{
        borderColor,
        boxShadow: selected ? `0 0 0 2px ${borderColor}40` : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} className="infra-handle" />
      <Handle type="target" position={Position.Left} className="infra-handle" />

      <div className="infra-node-icon">{nodeData.icon}</div>
      <div className="infra-node-label">{nodeData.label}</div>
      {nodeData.resourceType && (
        <div className="infra-node-type">{nodeData.resourceType}</div>
      )}

      <Handle type="source" position={Position.Bottom} className="infra-handle" />
      <Handle type="source" position={Position.Right} className="infra-handle" />
    </div>
  );
});

InfraNode.displayName = "InfraNode";
