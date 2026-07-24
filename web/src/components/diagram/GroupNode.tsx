/**
 * Group node for VPCs, subnets, regions, availability zones.
 * Acts as a container that other nodes can be dropped into.
 *
 * Author: Yogesh Tiwari
 */

import { memo } from "react";
import { type NodeProps, NodeResizer } from "@xyflow/react";

interface GroupNodeData {
  label: string;
  icon?: string;
  color?: string;
  [key: string]: unknown;
}

export const GroupNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as GroupNodeData;
  const color = nodeData.color || "#5b8cff";

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={150}
        lineStyle={{ borderColor: color }}
        handleStyle={{ backgroundColor: color, width: 8, height: 8 }}
      />
      <div className="group-node-header">
        {nodeData.icon && <span className="group-node-icon">{nodeData.icon}</span>}
        <span className="group-node-label" style={{ color }}>
          {nodeData.label}
        </span>
      </div>
    </>
  );
});

GroupNode.displayName = "GroupNode";
