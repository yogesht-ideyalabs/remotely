/**
 * Interactive Infrastructure Diagram Editor
 *
 * A draw.io-style editable canvas for building architecture and network diagrams.
 * Built on React Flow (@xyflow/react) with:
 * - Drag-and-drop shape palette (AWS, Azure, GCP, VMware, network, generic icons)
 * - Connectors with labels
 * - Grouping (VPCs, subnets, AZs, regions)
 * - Auto-layout from discovered infrastructure
 * - Export: PNG, SVG, JSON
 * - Save/load diagrams
 *
 * Author: Yogesh Tiwari
 */

import { useCallback, useRef, useState, useEffect, useMemo, type DragEvent } from "react";
import {
  ReactFlow,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  MiniMap,
  Background,
  Panel,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type OnConnect,
  BackgroundVariant,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { apiFetch } from "../api";
import { InfraNode } from "../components/diagram/InfraNode";
import { GroupNode } from "../components/diagram/GroupNode";
import { ShapePalette, type ShapeDefinition } from "../components/diagram/ShapePalette";
import { DiagramToolbar } from "../components/diagram/DiagramToolbar";
import { EdgeLabelEditor } from "../components/diagram/EdgeLabelEditor";

// Saved diagram shape
interface SavedDiagram {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

const nodeTypes: NodeTypes = {
  infra: InfraNode,
  group: GroupNode,
};

const defaultEdgeOptions = {
  animated: false,
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  style: { strokeWidth: 2 },
};

function DiagramEditorInner() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [diagramName, setDiagramName] = useState("Untitled Diagram");
  const [diagramId, setDiagramId] = useState<string | null>(null);
  const [savedDiagrams, setSavedDiagrams] = useState<SavedDiagram[]>([]);
  const [editingEdge, setEditingEdge] = useState<string | null>(null);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  const { screenToFlowPosition, getNodes, getEdges, fitView } = useReactFlow();

  // Load saved diagrams list
  useEffect(() => {
    apiFetch("/api/infra/diagrams")
      .then(setSavedDiagrams)
      .catch(() => {}); // endpoint may not exist yet
  }, []);

  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "default",
            data: { label: "" },
            ...defaultEdgeOptions,
          },
          eds
        )
      );
    },
    [setEdges]
  );

  // Drag and drop from shape palette
  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();

      const shapeData = event.dataTransfer.getData("application/reactflow");
      if (!shapeData) return;

      const shape: ShapeDefinition = JSON.parse(shapeData);
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node = {
        id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: shape.isGroup ? "group" : "infra",
        position,
        data: {
          label: shape.label,
          icon: shape.icon,
          provider: shape.provider,
          resourceType: shape.resourceType,
          color: shape.color || "#5b8cff",
        },
        ...(shape.isGroup
          ? {
              style: {
                width: 400,
                height: 300,
                backgroundColor: "rgba(91, 140, 255, 0.05)",
                borderRadius: 8,
                border: "2px dashed rgba(91, 140, 255, 0.3)",
              },
            }
          : {}),
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [screenToFlowPosition, setNodes]
  );

  // Save diagram
  const saveDiagram = useCallback(async () => {
    const payload = {
      id: diagramId,
      name: diagramName,
      nodes: getNodes(),
      edges: getEdges(),
    };

    try {
      const saved = await apiFetch("/api/infra/diagrams", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setDiagramId(saved.id);
      setSavedDiagrams((prev) => {
        const idx = prev.findIndex((d) => d.id === saved.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [...prev, saved];
      });
    } catch (err) {
      console.error("Save failed:", err);
    }
  }, [diagramId, diagramName, getNodes, getEdges]);

  // Load diagram
  const loadDiagram = useCallback(
    (diagram: SavedDiagram) => {
      setNodes(diagram.nodes);
      setEdges(diagram.edges);
      setDiagramName(diagram.name);
      setDiagramId(diagram.id);
      setShowLoadModal(false);
      setTimeout(() => fitView({ padding: 0.2 }), 100);
    },
    [setNodes, setEdges, fitView]
  );

  // Import from discovered infrastructure
  const importFromDiscovery = useCallback(async () => {
    try {
      const resources = await apiFetch("/api/infra/resources");
      if (!resources || resources.length === 0) {
        alert("No discovered resources to import. Run a discovery scan first.");
        return;
      }

      // Auto-layout: group by VPC, spread resources in a grid
      const vpcMap = new Map<string, typeof resources>();
      const noVpc: typeof resources = [];

      for (const r of resources) {
        const vpcId = r.networkInfo?.vpcId;
        if (vpcId) {
          if (!vpcMap.has(vpcId)) vpcMap.set(vpcId, []);
          vpcMap.get(vpcId)!.push(r);
        } else {
          noVpc.push(r);
        }
      }

      const newNodes: Node[] = [];
      let yOffset = 0;

      // Create VPC group nodes and their children
      for (const [vpcId, vpcResources] of vpcMap) {
        const vpcResource = vpcResources.find((r: { type: string }) => r.type === "vpc");
        const vpcName = vpcResource?.name || vpcId;

        // VPC group
        newNodes.push({
          id: `group-${vpcId}`,
          type: "group",
          position: { x: 50, y: yOffset },
          data: {
            label: vpcName,
            icon: "🌐",
            provider: vpcResources[0]?.provider || "aws",
            resourceType: "vpc",
            color: "#5b8cff",
          },
          style: {
            width: Math.max(600, vpcResources.length * 100),
            height: 350,
            backgroundColor: "rgba(91, 140, 255, 0.05)",
            borderRadius: 8,
            border: "2px dashed rgba(91, 140, 255, 0.3)",
          },
        });

        // Resources inside VPC
        let xPos = 80;
        let yPos = yOffset + 60;
        let col = 0;

        for (const r of vpcResources) {
          if (r.type === "vpc") continue; // skip the VPC itself
          newNodes.push({
            id: `node-${r.externalId || r.id}`,
            type: "infra",
            position: { x: xPos + col * 180, y: yPos },
            data: {
              label: r.name || r.externalId,
              icon: getIconForType(r.type),
              provider: r.provider,
              resourceType: r.type,
              color: getColorForType(r.type),
            },
            parentId: `group-${vpcId}`,
            extent: "parent" as const,
          });
          col++;
          if (col >= 4) {
            col = 0;
            yPos += 100;
          }
        }

        yOffset += 400;
      }

      // Resources not in a VPC
      if (noVpc.length > 0) {
        let xPos = 50;
        let yPos = yOffset + 50;
        let col = 0;

        for (const r of noVpc) {
          newNodes.push({
            id: `node-${r.externalId || r.id}`,
            type: "infra",
            position: { x: xPos + col * 180, y: yPos },
            data: {
              label: r.name || r.externalId,
              icon: getIconForType(r.type),
              provider: r.provider,
              resourceType: r.type,
              color: getColorForType(r.type),
            },
          });
          col++;
          if (col >= 5) {
            col = 0;
            yPos += 100;
          }
        }
      }

      // Build edges from relationships
      const newEdges: Edge[] = [];
      const nodeIds = new Set(newNodes.map((n) => n.id));

      for (const r of resources) {
        const sourceId = `node-${r.externalId || r.id}`;
        if (!nodeIds.has(sourceId)) continue;

        for (const rel of r.relationships || []) {
          const targetId = `node-${rel.targetResourceId}`;
          if (nodeIds.has(targetId)) {
            newEdges.push({
              id: `edge-${sourceId}-${targetId}`,
              source: sourceId,
              target: targetId,
              data: { label: rel.type },
              ...defaultEdgeOptions,
            });
          }
        }
      }

      setNodes(newNodes);
      setEdges(newEdges);
      setShowImportModal(false);
      setTimeout(() => fitView({ padding: 0.2 }), 200);
    } catch (err) {
      console.error("Import failed:", err);
      alert("Failed to import from discovery: " + (err as Error).message);
    }
  }, [setNodes, setEdges, fitView]);

  // Export as JSON
  const exportJSON = useCallback(() => {
    const data = {
      name: diagramName,
      nodes: getNodes(),
      edges: getEdges(),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${diagramName.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [diagramName, getNodes, getEdges]);

  // Export as PNG (uses canvas rendering)
  const exportPNG = useCallback(() => {
    const svgEl = reactFlowWrapper.current?.querySelector(".react-flow__viewport");
    if (!svgEl) return;

    // Use the built-in toSVG approach via html2canvas or similar
    // For now, export the SVG content
    const svgClone = svgEl.cloneNode(true) as SVGElement;
    const svgData = new XMLSerializer().serializeToString(svgClone);
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${diagramName.replace(/\s+/g, "-").toLowerCase()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [diagramName]);

  // Delete selected nodes/edges
  const deleteSelected = useCallback(() => {
    setNodes((nds) => nds.filter((n) => !n.selected));
    setEdges((eds) => eds.filter((e) => !e.selected));
  }, [setNodes, setEdges]);

  // Handle edge double-click to edit label
  const onEdgeDoubleClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setEditingEdge(edge.id);
  }, []);

  const updateEdgeLabel = useCallback(
    (edgeId: string, label: string) => {
      setEdges((eds) =>
        eds.map((e) => (e.id === edgeId ? { ...e, data: { ...e.data, label } } : e))
      );
      setEditingEdge(null);
    },
    [setEdges]
  );

  // Clear canvas
  const clearCanvas = useCallback(() => {
    if (confirm("Clear the entire canvas? This cannot be undone.")) {
      setNodes([]);
      setEdges([]);
      setDiagramId(null);
      setDiagramName("Untitled Diagram");
    }
  }, [setNodes, setEdges]);

  return (
    <div className="diagram-editor-page">
      <DiagramToolbar
        diagramName={diagramName}
        onNameChange={setDiagramName}
        onSave={saveDiagram}
        onLoad={() => setShowLoadModal(true)}
        onExportJSON={exportJSON}
        onExportSVG={exportPNG}
        onImportDiscovery={() => setShowImportModal(true)}
        onClear={clearCanvas}
        onDelete={deleteSelected}
      />

      <div className="diagram-editor-body">
        <ShapePalette />

        <div className="diagram-canvas" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onEdgeDoubleClick={onEdgeDoubleClick}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            deleteKeyCode={["Backspace", "Delete"]}
            multiSelectionKeyCode="Shift"
          >
            <Controls />
            <MiniMap
              nodeStrokeColor="#5b8cff"
              nodeColor={(n) => (n.type === "group" ? "rgba(91,140,255,0.1)" : "#1e2433")}
              maskColor="rgba(0,0,0,0.7)"
            />
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#2a3040" />

            <Panel position="bottom-center">
              <div className="diagram-hint">
                Drag shapes from the left panel • Double-click edges to label • Shift+click to multi-select
              </div>
            </Panel>
          </ReactFlow>
        </div>
      </div>

      {/* Edge label editor */}
      {editingEdge && (
        <EdgeLabelEditor
          edgeId={editingEdge}
          currentLabel={(edges.find((e) => e.id === editingEdge)?.data as { label?: string })?.label || ""}
          onSave={updateEdgeLabel}
          onCancel={() => setEditingEdge(null)}
        />
      )}

      {/* Load diagram modal */}
      {showLoadModal && (
        <div className="modal-overlay" onClick={() => setShowLoadModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Load Diagram</h3>
            {savedDiagrams.length === 0 ? (
              <p className="empty-state">No saved diagrams yet.</p>
            ) : (
              <div className="diagram-list">
                {savedDiagrams.map((d) => (
                  <button key={d.id} className="diagram-list-item" onClick={() => loadDiagram(d)}>
                    <strong>{d.name}</strong>
                    <span className="diagram-list-meta">
                      {new Date(d.updatedAt).toLocaleString()} • {d.nodes.length} nodes
                    </span>
                  </button>
                ))}
              </div>
            )}
            <button className="btn-secondary" onClick={() => setShowLoadModal(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Import from discovery modal */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Import from Infrastructure Discovery</h3>
            <p>
              This will populate the canvas with resources discovered from your configured
              infrastructure accounts. You can then freely edit, rearrange, and annotate the
              diagram.
            </p>
            <p className="text-dim">
              Existing canvas content will be replaced. Save your current diagram first if needed.
            </p>
            <div className="modal-actions">
              <button className="btn-primary" onClick={importFromDiscovery}>
                Import & Auto-Layout
              </button>
              <button className="btn-secondary" onClick={() => setShowImportModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DiagramEditor() {
  return (
    <ReactFlowProvider>
      <DiagramEditorInner />
    </ReactFlowProvider>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getIconForType(type: string): string {
  const icons: Record<string, string> = {
    vm: "🖥️",
    container: "📦",
    lambda: "⚡",
    "load-balancer": "⚖️",
    "rds-instance": "🗄️",
    "rds-cluster": "🗄️",
    "s3-bucket": "🪣",
    vpc: "🌐",
    subnet: "📡",
    "nat-gateway": "🔄",
    "internet-gateway": "🚪",
    "security-group": "🛡️",
    "proxmox-node": "🟩",
    "proxmox-vm": "🖥️",
    "proxmox-container": "📦",
    "elasticache": "⚡",
    "dynamodb-table": "📋",
    queue: "📬",
    cdn: "🌍",
  };
  return icons[type] || "📦";
}

function getColorForType(type: string): string {
  const colors: Record<string, string> = {
    vm: "#f97316",
    container: "#8b5cf6",
    lambda: "#eab308",
    "load-balancer": "#06b6d4",
    "rds-instance": "#3b82f6",
    "rds-cluster": "#3b82f6",
    "s3-bucket": "#22c55e",
    vpc: "#5b8cff",
    subnet: "#64748b",
    "nat-gateway": "#f59e0b",
    "internet-gateway": "#10b981",
    "security-group": "#ef4444",
  };
  return colors[type] || "#5b8cff";
}
