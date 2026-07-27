/**
 * Custom node for infrastructure resources on the diagram canvas.
 * Shows an icon, label, and handles for connections.
 *
 * Author: Yogesh Tiwari
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CloudIcon } from "./CloudIcon";

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
      <Handle type="target" position={Position.Top} className="infra-handle" />
      <Handle type="target" position={Position.Left} className="infra-handle" />

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

      <Handle type="source" position={Position.Bottom} className="infra-handle" />
      <Handle type="source" position={Position.Right} className="infra-handle" />
    </div>
  );
});

InfraNode.displayName = "InfraNode";
