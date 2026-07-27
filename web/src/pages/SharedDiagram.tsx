/**
 * Public, no-login diagram viewer — reachable at /share/:token with zero
 * authentication, unlike literally every other page in this app. Hits
 * GET /api/public/diagrams/:token directly (not apiFetch, which always
 * attaches a session token this page deliberately has none of).
 *
 * Read-only by construction, not just by convention: nodesDraggable/
 * nodesConnectable are off, and there's no save/edit path anywhere on this
 * page — same posture as Architecture.tsx's viewer, just outside the login
 * wall.
 *
 * Author: Yogesh Tiwari
 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ReactFlow, Controls, Background, BackgroundVariant, ReactFlowProvider, type Node, type Edge, type NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { InfraNode } from "../components/diagram/InfraNode";
import { GroupNode } from "../components/diagram/GroupNode";
import { NodePropertiesPanel } from "../components/diagram/NodePropertiesPanel";

const nodeTypes: NodeTypes = { infra: InfraNode, group: GroupNode };

interface SharedDiagramData {
  name: string;
  nodes: Node[];
  edges: Edge[];
  updatedAt: number;
}

function SharedDiagramInner() {
  const { token } = useParams();
  const [data, setData] = useState<SharedDiagramData | null>(null);
  const [error, setError] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/diagrams/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "Failed to load diagram");
        return res.json();
      })
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, [token]);

  if (error) {
    return (
      <div className="shared-diagram-error">
        <h1>🔗 Link unavailable</h1>
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="shared-diagram-error">
        <p>Loading…</p>
      </div>
    );
  }

  const selectedNode = selectedNodeId ? data.nodes.find((n) => n.id === selectedNodeId) ?? null : null;

  return (
    <div className="shared-diagram-page">
      <div className="shared-diagram-header">
        <div>
          <strong>{data.name}</strong>
          <span className="text-dim"> · shared from Remotely · read-only · updated {new Date(data.updatedAt).toLocaleString()}</span>
        </div>
      </div>
      <div className="shared-diagram-body">
        <div className="shared-diagram-canvas">
          <ReactFlow
            nodes={data.nodes}
            edges={data.edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            fitView
            fitViewOptions={{ padding: 0.2 }}
          >
            <Controls showInteractive={false} />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#2a3040" />
          </ReactFlow>
        </div>
        {selectedNode && (
          <NodePropertiesPanel
            node={selectedNode}
            allNodes={data.nodes}
            edges={data.edges}
            onUpdate={() => {}}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  );
}

export default function SharedDiagram() {
  return (
    <ReactFlowProvider>
      <SharedDiagramInner />
    </ReactFlowProvider>
  );
}
