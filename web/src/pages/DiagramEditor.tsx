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

import { useCallback, useRef, useState, useEffect, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
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
  getNodesBounds,
  getViewportForBounds,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { apiFetch, getSession } from "../api";
import { InfraNode } from "../components/diagram/InfraNode";
import { GroupNode } from "../components/diagram/GroupNode";
import { ShapePalette, type ShapeDefinition } from "../components/diagram/ShapePalette";
import { DiagramToolbar } from "../components/diagram/DiagramToolbar";
import { layoutNodes } from "../components/diagram/autoLayout";
import { EdgeLabelEditor, type EdgeStyleValue } from "../components/diagram/EdgeLabelEditor";
import { NodePropertiesPanel } from "../components/diagram/NodePropertiesPanel";
import { AlignDistributeToolbar, type AlignEdge, type DistributeAxis } from "../components/diagram/AlignDistributeToolbar";
import { ContextMenu, type ContextMenuItem } from "../components/diagram/ContextMenu";
import { KeyboardShortcutsModal } from "../components/diagram/KeyboardShortcutsModal";
import { AlignmentGuides } from "../components/diagram/AlignmentGuides";
import { DiagramVersionHistory } from "../components/diagram/DiagramVersionHistory";
import { PageTabs } from "../components/diagram/PageTabs";
import { ShareDiagramModal } from "../components/diagram/ShareDiagramModal";

const SNAP_THRESHOLD = 6;

interface ContextMenuState {
  x: number;
  y: number;
  kind: "node" | "edge" | "pane";
  targetId?: string;
}

function omitKeys<T extends object>(obj: T, keys: (keyof T)[]): T {
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}

// Strips selection/drag/measurement bookkeeping before diffing snapshots for
// undo history — without this, merely clicking a shape (which flips
// node.selected) would register as a history-worthy content change, forcing
// the user to press undo twice to see anything actually move.
function stripTransient(nodes: Node[], edges: Edge[]) {
  return {
    nodes: nodes.map((n) => omitKeys(n, ["selected", "dragging", "measured"])),
    edges: edges.map((e) => omitKeys(e, ["selected"])),
  };
}

// Saved diagram shape
interface DiagramPage {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
}

interface SavedDiagram {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  pages?: DiagramPage[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  isAuto?: boolean;
  autoDescription?: string;
  shareToken?: string;
}

function defaultPage(): DiagramPage {
  return { id: `page-${Date.now()}`, name: "Page 1", nodes: [], edges: [] };
}

const nodeTypes: NodeTypes = {
  infra: InfraNode,
  group: GroupNode,
};

const defaultEdgeOptions = {
  type: "smoothstep",
  animated: false,
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  style: { strokeWidth: 2 },
};

function DiagramEditorInner() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [diagramName, setDiagramName] = useState("Untitled Diagram");
  const [diagramId, setDiagramId] = useState<string | null>(null);
  const [savedDiagrams, setSavedDiagrams] = useState<SavedDiagram[]>([]);
  const [editingEdge, setEditingEdge] = useState<string | null>(null);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [historyDiagram, setHistoryDiagram] = useState<{ id: string; name: string } | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareToken, setShareToken] = useState<string | undefined>(undefined);

  // ─── Multi-page diagrams ────────────────────────────────────────────────
  // Only the active page's content lives in React Flow's own nodes/edges
  // state at any moment; the rest sit here as plain snapshots. Switching
  // pages flushes the outgoing page's live content into `pages` first.
  const [pages, setPages] = useState<DiagramPage[]>([defaultPage()]);
  const [activePageId, setActivePageId] = useState(pages[0].id);

  const { screenToFlowPosition, getNodes, getEdges, fitView } = useReactFlow();

  // ─── Undo / redo history ───────────────────────────────────────────────
  // Snapshots the whole nodes/edges state, debounced so a drag doesn't
  // spam the stack with every intermediate frame — one entry per "settled"
  // change, the same granularity draw.io's undo gives you.
  const [historyState, setHistoryState] = useState<{ stack: { nodes: Node[]; edges: Edge[] }[]; index: number }>({ stack: [], index: -1 });
  const restoringHistory = useRef(false);
  const historyDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (restoringHistory.current) {
      restoringHistory.current = false;
      return;
    }
    if (historyDebounce.current) clearTimeout(historyDebounce.current);
    historyDebounce.current = setTimeout(() => {
      const snapshot = stripTransient(nodes, edges);
      setHistoryState((hs) => {
        const truncated = hs.stack.slice(0, hs.index + 1);
        const last = truncated[truncated.length - 1];
        if (last && JSON.stringify(last) === JSON.stringify(snapshot)) return hs;
        const nextStack = [...truncated, snapshot].slice(-50);
        return { stack: nextStack, index: nextStack.length - 1 };
      });
    }, 350);
    return () => {
      if (historyDebounce.current) clearTimeout(historyDebounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  const canUndo = historyState.index > 0;
  const canRedo = historyState.index < historyState.stack.length - 1;

  const undo = useCallback(() => {
    setHistoryState((hs) => {
      if (hs.index <= 0) return hs;
      const newIndex = hs.index - 1;
      restoringHistory.current = true;
      const snap = hs.stack[newIndex];
      setNodes(snap.nodes);
      setEdges(snap.edges);
      return { ...hs, index: newIndex };
    });
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    setHistoryState((hs) => {
      if (hs.index >= hs.stack.length - 1) return hs;
      const newIndex = hs.index + 1;
      restoringHistory.current = true;
      const snap = hs.stack[newIndex];
      setNodes(snap.nodes);
      setEdges(snap.edges);
      return { ...hs, index: newIndex };
    });
  }, [setNodes, setEdges]);

  // ─── Clipboard: copy / paste / duplicate ───────────────────────────────
  const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);

  const copySelected = useCallback(() => {
    const selectedNodes = getNodes().filter((n) => n.selected);
    if (selectedNodes.length === 0) return;
    const selectedIds = new Set(selectedNodes.map((n) => n.id));
    const relevantEdges = getEdges().filter((e) => selectedIds.has(e.source) && selectedIds.has(e.target));
    clipboardRef.current = {
      nodes: JSON.parse(JSON.stringify(selectedNodes)),
      edges: JSON.parse(JSON.stringify(relevantEdges)),
    };
  }, [getNodes, getEdges]);

  const pasteClipboard = useCallback(
    (offset = 40) => {
      const clip = clipboardRef.current;
      if (!clip || clip.nodes.length === 0) return;
      const idMap = new Map<string, string>();
      const newNodes: Node[] = clip.nodes.map((n) => {
        const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        idMap.set(n.id, newId);
        return {
          ...n,
          id: newId,
          position: { x: n.position.x + offset, y: n.position.y + offset },
          selected: true,
          // Pasted copies land as free-floating top-level shapes rather
          // than silently re-parenting into a group they may no longer
          // visually overlap.
          parentId: undefined,
          extent: undefined,
        };
      });
      const newEdges: Edge[] = clip.edges
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => ({
          ...e,
          id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          source: idMap.get(e.source)!,
          target: idMap.get(e.target)!,
          selected: false,
        }));
      setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...newNodes]);
      setEdges((eds) => [...eds, ...newEdges]);
    },
    [setNodes, setEdges]
  );

  const duplicateSelected = useCallback(() => {
    copySelected();
    pasteClipboard(30);
  }, [copySelected, pasteClipboard]);

  // ─── Align / distribute selected shapes ────────────────────────────────
  const alignSelected = useCallback(
    (edge: AlignEdge) => {
      const selected = getNodes().filter((n) => n.selected);
      if (selected.length < 2) return;
      const dims = (n: Node) => ({ w: n.measured?.width ?? 180, h: n.measured?.height ?? 60 });
      let target: number;
      switch (edge) {
        case "left": target = Math.min(...selected.map((n) => n.position.x)); break;
        case "right": target = Math.max(...selected.map((n) => n.position.x + dims(n).w)); break;
        case "centerH": target = (Math.min(...selected.map((n) => n.position.x)) + Math.max(...selected.map((n) => n.position.x + dims(n).w))) / 2; break;
        case "top": target = Math.min(...selected.map((n) => n.position.y)); break;
        case "bottom": target = Math.max(...selected.map((n) => n.position.y + dims(n).h)); break;
        case "middle": target = (Math.min(...selected.map((n) => n.position.y)) + Math.max(...selected.map((n) => n.position.y + dims(n).h))) / 2; break;
      }
      const selectedIds = new Set(selected.map((n) => n.id));
      setNodes((nds) =>
        nds.map((n) => {
          if (!selectedIds.has(n.id)) return n;
          const { w, h } = dims(n);
          switch (edge) {
            case "left": return { ...n, position: { ...n.position, x: target } };
            case "right": return { ...n, position: { ...n.position, x: target - w } };
            case "centerH": return { ...n, position: { ...n.position, x: target - w / 2 } };
            case "top": return { ...n, position: { ...n.position, y: target } };
            case "bottom": return { ...n, position: { ...n.position, y: target - h } };
            case "middle": return { ...n, position: { ...n.position, y: target - h / 2 } };
            default: return n;
          }
        })
      );
    },
    [getNodes, setNodes]
  );

  const distributeSelected = useCallback(
    (axis: DistributeAxis) => {
      const selected = getNodes().filter((n) => n.selected);
      if (selected.length < 3) return;
      const dims = (n: Node) => ({ w: n.measured?.width ?? 180, h: n.measured?.height ?? 60 });
      const sorted = [...selected].sort((a, b) => (axis === "horizontal" ? a.position.x - b.position.x : a.position.y - b.position.y));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const positions = new Map<string, number>();
      if (axis === "horizontal") {
        const totalSpan = last.position.x + dims(last).w - first.position.x;
        const totalWidth = sorted.reduce((sum, n) => sum + dims(n).w, 0);
        const gap = (totalSpan - totalWidth) / (sorted.length - 1);
        let cursor = first.position.x;
        for (const n of sorted) {
          positions.set(n.id, cursor);
          cursor += dims(n).w + gap;
        }
        setNodes((nds) => nds.map((n) => (positions.has(n.id) ? { ...n, position: { ...n.position, x: positions.get(n.id)! } } : n)));
      } else {
        const totalSpan = last.position.y + dims(last).h - first.position.y;
        const totalHeight = sorted.reduce((sum, n) => sum + dims(n).h, 0);
        const gap = (totalSpan - totalHeight) / (sorted.length - 1);
        let cursor = first.position.y;
        for (const n of sorted) {
          positions.set(n.id, cursor);
          cursor += dims(n).h + gap;
        }
        setNodes((nds) => nds.map((n) => (positions.has(n.id) ? { ...n, position: { ...n.position, y: positions.get(n.id)! } } : n)));
      }
    },
    [getNodes, setNodes]
  );

  const selectedCount = nodes.filter((n) => n.selected).length;

  // ─── Live smart alignment guides ───────────────────────────────────────
  // Standard React Flow "helper lines" recipe: on every drag tick, compare
  // the dragged shape's edges/center against every other shape's, and if
  // any pair is within SNAP_THRESHOLD, both show a guide line at that
  // position AND nudge the dragged node's position to land exactly on it.
  // Overriding position here doesn't fight React Flow's own drag handling
  // because this only ever runs from inside its own onNodeDrag callback —
  // it's the same call stack, not a competing external write.
  const [guides, setGuides] = useState<{ vertical: number[]; horizontal: number[] }>({ vertical: [], horizontal: [] });

  const onNodeDrag = useCallback(
    (_: ReactMouseEvent, node: Node) => {
      const others = getNodes().filter((n) => n.id !== node.id && !n.selected);
      const w = node.measured?.width ?? 180;
      const h = node.measured?.height ?? 60;
      const left = node.position.x;
      const right = node.position.x + w;
      const centerX = node.position.x + w / 2;
      const top = node.position.y;
      const bottom = node.position.y + h;
      const centerY = node.position.y + h / 2;

      const vLines = new Set<number>();
      const hLines = new Set<number>();
      let snapDX: number | null = null;
      let snapDY: number | null = null;

      for (const other of others) {
        const ow = other.measured?.width ?? 180;
        const oh = other.measured?.height ?? 60;
        const oLeft = other.position.x;
        const oRight = other.position.x + ow;
        const oCenterX = other.position.x + ow / 2;
        const oTop = other.position.y;
        const oBottom = other.position.y + oh;
        const oCenterY = other.position.y + oh / 2;

        for (const [a, b] of [[left, oLeft], [right, oRight], [centerX, oCenterX], [left, oRight], [right, oLeft]] as [number, number][]) {
          if (Math.abs(a - b) <= SNAP_THRESHOLD) {
            vLines.add(b);
            if (snapDX === null) snapDX = b - a;
          }
        }
        for (const [a, b] of [[top, oTop], [bottom, oBottom], [centerY, oCenterY], [top, oBottom], [bottom, oTop]] as [number, number][]) {
          if (Math.abs(a - b) <= SNAP_THRESHOLD) {
            hLines.add(b);
            if (snapDY === null) snapDY = b - a;
          }
        }
      }

      setGuides({ vertical: Array.from(vLines), horizontal: Array.from(hLines) });

      if (snapDX !== null || snapDY !== null) {
        const dx = snapDX ?? 0;
        const dy = snapDY ?? 0;
        setNodes((nds) => nds.map((n) => (n.id === node.id ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)));
      }
    },
    [getNodes, setNodes]
  );

  const onNodeDragStop = useCallback(() => {
    setGuides({ vertical: [], horizontal: [] });
  }, []);

  // Load saved diagrams list
  useEffect(() => {
    apiFetch("/api/infra/diagrams")
      .then(setSavedDiagrams)
      .catch(() => {}); // endpoint may not exist yet
  }, []);

  // ─── Presence + remote-save notifications ──────────────────────────────
  // Only meaningful once a diagram has an id (been saved at least once) —
  // an unsaved "Untitled Diagram" has no server-side identity for other
  // viewers to converge on. See state.ts's diagramViewers comment for what
  // this deliberately is (presence + "someone else saved, reload") and
  // isn't (live multi-cursor co-editing).
  const [viewers, setViewers] = useState<string[]>([]);
  const [remoteUpdateBy, setRemoteUpdateBy] = useState<string | null>(null);

  useEffect(() => {
    setViewers([]);
    setRemoteUpdateBy(null);
    if (!diagramId) return;

    const session = getSession();
    if (!session) return;

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${proto}://${window.location.host}/diagram-collab?token=${encodeURIComponent(session.token)}&diagramId=${encodeURIComponent(diagramId)}`
    );

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "presence") {
        setViewers((msg.viewers as string[]).filter((v) => v !== session.username));
      } else if (msg.type === "diagram-updated" && msg.by !== session.username) {
        setRemoteUpdateBy(msg.by);
      }
    };

    return () => ws.close();
  }, [diagramId]);

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
          customImage: shape.customImage,
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
    const currentNodes = getNodes();
    const currentEdges = getEdges();
    // Merge the live active page's content into the pages array before
    // saving — `pages` only reflects what it was as of the last page
    // switch otherwise, missing whatever's been edited since.
    const pagesForSave = pages.map((p) => (p.id === activePageId ? { ...p, nodes: currentNodes, edges: currentEdges } : p));
    const payload = {
      id: diagramId,
      name: diagramName,
      // Mirrors the first page — see the `nodes`/`edges` comment on
      // SavedDiagram in diagramStore.ts for why.
      nodes: pagesForSave[0].nodes,
      edges: pagesForSave[0].edges,
      pages: pagesForSave.length > 1 ? pagesForSave : undefined,
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
  }, [diagramId, diagramName, getNodes, getEdges, pages, activePageId]);

  // Load diagram
  const loadDiagram = useCallback(
    (diagram: SavedDiagram) => {
      // Legacy/auto diagrams have no `pages` — synthesize a single page so
      // the rest of the editor (page tabs, switchPage, save) doesn't need
      // to special-case "no pages" everywhere.
      const loadedPages: DiagramPage[] =
        diagram.pages && diagram.pages.length > 0
          ? diagram.pages
          : [{ id: `page-${Date.now()}`, name: "Page 1", nodes: diagram.nodes, edges: diagram.edges }];
      setPages(loadedPages);
      setActivePageId(loadedPages[0].id);
      setNodes(loadedPages[0].nodes);
      setEdges(loadedPages[0].edges);
      setDiagramName(diagram.name);
      setDiagramId(diagram.id);
      setShareToken(diagram.shareToken);
      setShowLoadModal(false);
      setTimeout(() => fitView({ padding: 0.2 }), 100);
    },
    [setNodes, setEdges, fitView]
  );

  const reloadFromRemote = useCallback(async () => {
    if (!diagramId) return;
    try {
      const fresh = await apiFetch(`/api/infra/diagrams/${diagramId}`);
      loadDiagram(fresh);
    } finally {
      setRemoteUpdateBy(null);
    }
  }, [diagramId, loadDiagram]);

  // Full resource -> node.data mapping, shared by both branches below.
  // Spreads `properties` directly into data so NodePropertiesPanel's
  // existing per-type fields (data.instanceType, data.engine, data.cidr,
  // ...) are populated instead of empty — they were never actually wired
  // up before, so every imported node's properties panel showed blank
  // type-specific sections despite the UI for them already existing.
  // Also carries tags/region/accountId/networkInfo through so the panel's
  // generic sections (added alongside this) have real data to show.
  function resourceToNodeData(r: {
    name?: string;
    externalId: string;
    type: string;
    provider: string;
    region?: string;
    accountId?: string;
    tags?: Record<string, string>;
    networkInfo?: Record<string, unknown>;
    properties?: Record<string, unknown>;
  }) {
    return {
      label: r.name || r.externalId,
      icon: getIconForType(r.type),
      provider: r.provider,
      resourceType: r.type,
      color: getColorForType(r.type),
      region: r.region,
      accountId: r.accountId,
      tags: r.tags ?? {},
      networkInfo: r.networkInfo ?? {},
      ...(r.properties ?? {}),
    };
  }

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
            data: resourceToNodeData(r),
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
            data: resourceToNodeData(r),
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

  const downloadTextFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportMermaid = useCallback(() => {
    const sanitize = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, "_");
    const label = (n: Node) => String((n.data as { label?: string }).label ?? n.id);
    const currentNodes = getNodes();
    const currentEdges = getEdges();
    const lines = ["graph TD"];
    const groupedIds = new Set<string>();

    for (const g of currentNodes.filter((n) => n.type === "group")) {
      lines.push(`  subgraph ${sanitize(g.id)}["${label(g)}"]`);
      for (const child of currentNodes.filter((n) => n.parentId === g.id)) {
        groupedIds.add(child.id);
        lines.push(`    ${sanitize(child.id)}["${label(child)}"]`);
      }
      lines.push("  end");
    }
    for (const n of currentNodes) {
      if (n.type === "group" || groupedIds.has(n.id)) continue;
      lines.push(`  ${sanitize(n.id)}["${label(n)}"]`);
    }
    for (const e of currentEdges) {
      const edgeLabel = (e.data as { label?: string } | undefined)?.label;
      lines.push(`  ${sanitize(e.source)} -->${edgeLabel ? `|${edgeLabel}|` : ""} ${sanitize(e.target)}`);
    }

    downloadTextFile(lines.join("\n"), `${diagramName.replace(/\s+/g, "-").toLowerCase()}.mmd`, "text/plain");
  }, [diagramName, getNodes, getEdges]);

  const exportCSV = useCallback(() => {
    const csvEscape = (v: unknown): string => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Name", "Resource Type", "Provider", "Region", "Account", "Tags"];
    const rows = getNodes()
      .filter((n) => n.type === "infra")
      .map((n) => {
        const d = n.data as Record<string, unknown>;
        const tags = (d.tags as Record<string, string>) || {};
        const tagsStr = Object.entries(tags)
          .map(([k, v]) => `${k}=${v}`)
          .join("; ");
        return [d.label, d.resourceType, d.provider, d.region, d.accountName, tagsStr].map(csvEscape).join(",");
      });
    downloadTextFile([header.join(","), ...rows].join("\n"), `${diagramName.replace(/\s+/g, "-").toLowerCase()}.csv`, "text/csv");
  }, [diagramName, getNodes]);

  // Delete selected nodes/edges
  const deleteSelected = useCallback(() => {
    setNodes((nds) => nds.filter((n) => !n.selected));
    setEdges((eds) => eds.filter((e) => !e.selected));
  }, [setNodes, setEdges]);

  // Handle edge double-click to edit its label/routing/style
  const onEdgeDoubleClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setEditingEdge(edge.id);
  }, []);

  const saveEdgeStyle = useCallback(
    (edgeId: string, value: EdgeStyleValue) => {
      setEdges((eds) =>
        eds.map((e) =>
          e.id === edgeId
            ? {
                ...e,
                type: value.routing,
                data: { ...e.data, label: value.label },
                style: { ...e.style, stroke: value.color, strokeWidth: 2, strokeDasharray: value.dashed ? "6 4" : undefined },
                markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: value.color },
              }
            : e
        )
      );
      setEditingEdge(null);
    },
    [setEdges]
  );

  // ─── Right-click context menu ──────────────────────────────────────────
  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: Node) => {
      event.preventDefault();
      if (!node.selected) {
        setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === node.id })));
      }
      setContextMenu({ x: event.clientX, y: event.clientY, kind: "node", targetId: node.id });
    },
    [setNodes]
  );

  const onEdgeContextMenu = useCallback((event: ReactMouseEvent, edge: Edge) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, kind: "edge", targetId: edge.id });
  }, []);

  const onPaneContextMenu = useCallback((event: ReactMouseEvent | MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, kind: "pane" });
  }, []);

  // Only meaningful for top-level shapes — a group's children need to stay
  // ordered after their parent for React Flow's nesting to render right, so
  // z-order changes are scoped to nodes with no parentId.
  const bringToFront = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const target = nds.find((n) => n.id === nodeId);
        if (!target) return nds;
        return [...nds.filter((n) => n.id !== nodeId), target];
      });
    },
    [setNodes]
  );

  const sendToBack = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const target = nds.find((n) => n.id === nodeId);
        if (!target) return nds;
        return [target, ...nds.filter((n) => n.id !== nodeId)];
      });
    },
    [setNodes]
  );

  // Locking only prevents accidental drag — a locked shape can still be
  // deleted or restyled deliberately via the context menu / properties
  // panel, unlike draw.io's stricter lock which also blocks delete. Sets
  // `node.draggable` (the actual thing React Flow checks) in lockstep with
  // `data.locked` (what the lock badge/opacity in InfraNode.tsx reads).
  const toggleLock = useCallback(
    (nodeId: string) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const locked = !(n.data as { locked?: boolean }).locked;
          return { ...n, draggable: !locked, data: { ...n.data, locked } };
        })
      );
    },
    [setNodes]
  );

  // Clear canvas
  const clearCanvas = useCallback(() => {
    if (confirm("Clear the entire canvas? This cannot be undone.")) {
      setNodes([]);
      setEdges([]);
      setDiagramId(null);
      setDiagramName("Untitled Diagram");
      setShareToken(undefined);
      const fresh = defaultPage();
      setPages([fresh]);
      setActivePageId(fresh.id);
    }
  }, [setNodes, setEdges]);

  // ─── Page management ────────────────────────────────────────────────────
  const switchPage = useCallback(
    (pageId: string) => {
      if (pageId === activePageId) return;
      const currentNodes = getNodes();
      const currentEdges = getEdges();
      setPages((prev) => prev.map((p) => (p.id === activePageId ? { ...p, nodes: currentNodes, edges: currentEdges } : p)));
      const target = pages.find((p) => p.id === pageId);
      setNodes(target?.nodes ?? []);
      setEdges(target?.edges ?? []);
      setActivePageId(pageId);
      setSelectedNodeId(null);
      setTimeout(() => fitView({ padding: 0.2 }), 50);
    },
    [activePageId, pages, getNodes, getEdges, setNodes, setEdges, fitView]
  );

  const addPage = useCallback(() => {
    const currentNodes = getNodes();
    const currentEdges = getEdges();
    const newPage: DiagramPage = { id: `page-${Date.now()}`, name: `Page ${pages.length + 1}`, nodes: [], edges: [] };
    setPages((prev) => [...prev.map((p) => (p.id === activePageId ? { ...p, nodes: currentNodes, edges: currentEdges } : p)), newPage]);
    setNodes([]);
    setEdges([]);
    setActivePageId(newPage.id);
    setSelectedNodeId(null);
  }, [activePageId, pages.length, getNodes, getEdges, setNodes, setEdges]);

  const renamePage = useCallback((pageId: string) => {
    setPages((prev) => {
      const page = prev.find((p) => p.id === pageId);
      const name = prompt("Page name:", page?.name ?? "");
      if (!name) return prev;
      return prev.map((p) => (p.id === pageId ? { ...p, name } : p));
    });
  }, []);

  const deletePage = useCallback(
    (pageId: string) => {
      if (pages.length <= 1) return;
      if (!confirm("Delete this page? This cannot be undone.")) return;
      const remaining = pages.filter((p) => p.id !== pageId);
      setPages(remaining);
      if (pageId === activePageId) {
        const next = remaining[0];
        setNodes(next.nodes);
        setEdges(next.edges);
        setActivePageId(next.id);
        setSelectedNodeId(null);
      }
    },
    [pages, activePageId, setNodes, setEdges]
  );

  // Node click — open properties panel
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  // Close properties panel when clicking canvas background
  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Update node properties from the panel
  const updateNodeData = useCallback(
    (nodeId: string, newData: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...newData } } : n))
      );
    },
    [setNodes]
  );

  // Export as PNG using canvas
  // Renders the whole diagram (not just whatever's currently visible/panned
  // to) at a fixed export resolution, using React Flow's own
  // getNodesBounds/getViewportForBounds helpers — the officially recommended
  // approach for "export the full diagram regardless of current pan/zoom."
  // Previously this hand-serialized the (plain HTML `<div>`) viewport
  // element with XMLSerializer and fed it to `<img src="data:image/svg+xml...">` —
  // that only works if the root element is an actual `<svg>`, so it silently
  // produced a broken image (onload never fired) for every export. Replaced
  // with `html-to-image`, which properly inlines computed styles into a
  // valid wrapping SVG before rasterizing — the same library React Flow's
  // own official "download image" example uses for exactly this reason.
  const captureDiagramImage = useCallback(async () => {
    const viewportEl = reactFlowWrapper.current?.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!viewportEl) return null;

    const bounds = getNodesBounds(getNodes());
    const width = Math.max(Math.round(bounds.width), 100) + 80;
    const height = Math.max(Math.round(bounds.height), 100) + 80;
    const transform = getViewportForBounds(bounds, width, height, 0.2, 2, 40);

    const dataUrl = await toPng(viewportEl, {
      backgroundColor: "#0b0e14",
      width,
      height,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
      },
    });
    return { dataUrl, width, height };
  }, [getNodes]);

  const exportPNG = useCallback(async () => {
    const result = await captureDiagramImage();
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.dataUrl;
    a.download = `${diagramName.replace(/\s+/g, "-").toLowerCase()}.png`;
    a.click();
  }, [captureDiagramImage, diagramName]);

  const exportPDF = useCallback(async () => {
    const result = await captureDiagramImage();
    if (!result) return;
    const orientation = result.width >= result.height ? "landscape" : "portrait";
    const pdf = new jsPDF({ orientation, unit: "px", format: [result.width, result.height] });
    pdf.addImage(result.dataUrl, "PNG", 0, 0, result.width, result.height);
    pdf.save(`${diagramName.replace(/\s+/g, "-").toLowerCase()}.pdf`);
  }, [captureDiagramImage, diagramName]);

  // A single static HTML file with the diagram baked in as an embedded
  // image — opens in any browser, no server, no login. Distinct from the
  // "Share" link above: this is a point-in-time snapshot you attach to an
  // email or drop in a wiki page; the share link is always live/current.
  const exportHTML = useCallback(async () => {
    const result = await captureDiagramImage();
    if (!result) return;
    const escapedName = diagramName.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapedName}</title>
<style>
  body { margin: 0; background: #0b0e14; display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: -apple-system, sans-serif; }
  img { max-width: 100%; height: auto; }
  h1 { color: #e8ecf3; position: fixed; top: 12px; left: 16px; font-size: 14px; margin: 0; }
</style>
</head>
<body>
<h1>${escapedName}</h1>
<img src="${result.dataUrl}" width="${result.width}" height="${result.height}" alt="${escapedName}" />
</body>
</html>`;
    downloadTextFile(html, `${diagramName.replace(/\s+/g, "-").toLowerCase()}.html`, "text/html");
  }, [captureDiagramImage, diagramName]);

  // The selected node object
  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;

  // Hide welcome once user has nodes or dismissed it
  useEffect(() => {
    if (nodes.length > 0) setShowWelcome(false);
  }, [nodes.length]);

  // ─── Global keyboard shortcuts (draw.io-equivalent set) ────────────────
  // Skipped entirely while a text field has focus so native text-editing
  // undo/copy/paste inside the properties panel's inputs keeps working
  // unmodified.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const isEditable = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
      if (isEditable) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && key === "y") { e.preventDefault(); redo(); return; }
      if (mod && key === "c") { e.preventDefault(); copySelected(); return; }
      if (mod && key === "v") { e.preventDefault(); pasteClipboard(); return; }
      if (mod && key === "d") { e.preventDefault(); duplicateSelected(); return; }
      if (mod && key === "a") { e.preventDefault(); setNodes((nds) => nds.map((n) => ({ ...n, selected: true }))); return; }
      if (e.key === "?") { setShowShortcuts(true); return; }
      if (e.key === "Escape") { setSelectedNodeId(null); setContextMenu(null); setShowShortcuts(false); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, copySelected, pasteClipboard, duplicateSelected, setNodes]);

  // Current style values fed into the edge editor modal, derived from
  // whichever edge is being double-clicked (falls back to sane defaults for
  // an edge created before styling existed).
  const editingEdgeObj = editingEdge ? edges.find((e) => e.id === editingEdge) : null;
  const currentEdgeValue: EdgeStyleValue | null = editingEdgeObj
    ? {
        label: (editingEdgeObj.data as { label?: string } | undefined)?.label || "",
        routing: (editingEdgeObj.type as EdgeStyleValue["routing"]) || "smoothstep",
        dashed: Boolean((editingEdgeObj.style as Record<string, unknown> | undefined)?.strokeDasharray),
        color: (editingEdgeObj.style as { stroke?: string } | undefined)?.stroke || "#8a94a8",
      }
    : null;

  function buildContextMenuItems(menu: ContextMenuState): ContextMenuItem[] {
    if (menu.kind === "pane") {
      return [
        { label: "Paste", onClick: () => pasteClipboard(), disabled: !clipboardRef.current },
        { label: "Select all", onClick: () => setNodes((nds) => nds.map((n) => ({ ...n, selected: true }))) },
      ];
    }
    if (menu.kind === "edge") {
      const edgeId = menu.targetId!;
      return [
        { label: "Edit style / label", onClick: () => setEditingEdge(edgeId) },
        { label: "Delete", danger: true, onClick: () => setEdges((eds) => eds.filter((e) => e.id !== edgeId)) },
      ];
    }
    const nodeId = menu.targetId!;
    const node = nodes.find((n) => n.id === nodeId);
    const canReorder = Boolean(node) && node!.type !== "group" && !node!.parentId;
    const isLocked = Boolean((node?.data as { locked?: boolean } | undefined)?.locked);
    return [
      { label: "Copy", onClick: () => copySelected() },
      { label: "Paste", onClick: () => pasteClipboard(), disabled: !clipboardRef.current },
      { label: "Duplicate", onClick: () => duplicateSelected() },
      { divider: true, label: "", onClick: () => {} },
      { label: "Bring to front", onClick: () => bringToFront(nodeId), disabled: !canReorder },
      { label: "Send to back", onClick: () => sendToBack(nodeId), disabled: !canReorder },
      { divider: true, label: "", onClick: () => {} },
      { label: isLocked ? "Unlock" : "Lock", onClick: () => toggleLock(nodeId) },
      { label: "Delete", danger: true, onClick: () => deleteSelected() },
    ];
  }

  return (
    <div className="diagram-editor-page">
      <DiagramToolbar
        diagramName={diagramName}
        onNameChange={setDiagramName}
        onSave={saveDiagram}
        onLoad={() => setShowLoadModal(true)}
        onExportJSON={exportJSON}
        onExportPNG={exportPNG}
        onExportPDF={exportPDF}
        onExportMermaid={exportMermaid}
        onExportCSV={exportCSV}
        onExportHTML={exportHTML}
        onImportDiscovery={() => { setShowImportModal(true); setShowWelcome(false); }}
        onAutoLayout={() => {
          setNodes((nds) => layoutNodes(nds, edges));
          setTimeout(() => fitView({ padding: 0.2 }), 50);
        }}
        onClear={clearCanvas}
        onDelete={deleteSelected}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        onCopy={copySelected}
        onPaste={() => pasteClipboard()}
        onDuplicate={duplicateSelected}
        onShowShortcuts={() => setShowShortcuts(true)}
        onShare={() => setShowShareModal(true)}
        shareDisabled={!diagramId}
      />

      <div className="diagram-editor-body">
        <ShapePalette />

        <div className="diagram-canvas">
        <div className="diagram-canvas-inner" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onEdgeDoubleClick={onEdgeDoubleClick}
            onNodeClick={onNodeClick}
            onPaneClick={() => { onPaneClick(); setContextMenu(null); }}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeContextMenu={onEdgeContextMenu}
            onPaneContextMenu={onPaneContextMenu}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            proOptions={{ hideAttribution: true }}
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

            <Panel position="top-center">
              <AlignDistributeToolbar selectedCount={selectedCount} onAlign={alignSelected} onDistribute={distributeSelected} />
            </Panel>

            {/* Welcome / Auto-Build prompt when canvas is empty */}
            {showWelcome && nodes.length === 0 && (
              <Panel position="top-center">
                <div className="welcome-panel">
                  <h2>🗺️ Infrastructure Diagram Editor</h2>
                  <p>Choose how to start:</p>
                  <div className="welcome-options">
                    <button className="welcome-option" onClick={() => { setShowImportModal(true); setShowWelcome(false); }}>
                      <span className="welcome-icon">🔍</span>
                      <strong>Auto-Build from Live Infrastructure</strong>
                      <span className="welcome-desc">Pull resources from your AWS/Azure/GCP accounts and auto-generate the diagram</span>
                    </button>
                    <button className="welcome-option" onClick={() => setShowWelcome(false)}>
                      <span className="welcome-icon">✏️</span>
                      <strong>Draw Manually</strong>
                      <span className="welcome-desc">Drag shapes from the left panel to build your architecture from scratch</span>
                    </button>
                    <button className="welcome-option" onClick={() => { setShowLoadModal(true); setShowWelcome(false); }}>
                      <span className="welcome-icon">📂</span>
                      <strong>Load Saved Diagram</strong>
                      <span className="welcome-desc">Open a previously saved diagram and continue editing</span>
                    </button>
                  </div>
                </div>
              </Panel>
            )}

            {!showWelcome && (
              <Panel position="bottom-center">
                <div className="diagram-hint">
                  Drag shapes from the left • Click a node to configure it • Double-click edges to style • Right-click for more • Del to delete • ? for shortcuts
                </div>
              </Panel>
            )}
          </ReactFlow>

          <AlignmentGuides vertical={guides.vertical} horizontal={guides.horizontal} />

          {viewers.length > 0 && (
            <div className="collab-presence" title={`Also viewing: ${viewers.join(", ")}`}>
              👥 {viewers.length} {viewers.length === 1 ? "other" : "others"} viewing
            </div>
          )}

          {remoteUpdateBy && (
            <div className="collab-update-banner">
              <span>
                🔄 <strong>{remoteUpdateBy}</strong> just saved changes to this diagram.
              </span>
              <button className="btn-sm" onClick={reloadFromRemote}>Reload</button>
              <button className="btn-sm" onClick={() => setRemoteUpdateBy(null)}>Dismiss</button>
            </div>
          )}

          {contextMenu && (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onClose={() => setContextMenu(null)}
              items={buildContextMenuItems(contextMenu)}
            />
          )}
        </div>

          <PageTabs
            pages={pages.map((p) => ({ id: p.id, name: p.name }))}
            activePageId={activePageId}
            onSwitch={switchPage}
            onAdd={addPage}
            onRename={renamePage}
            onDelete={deletePage}
          />
        </div>

        {/* Node Properties Panel (right sidebar) */}
        {selectedNode && (
          <NodePropertiesPanel
            node={selectedNode}
            allNodes={nodes}
            edges={edges}
            onUpdate={updateNodeData}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>

      {/* Edge style editor */}
      {editingEdge && currentEdgeValue && (
        <EdgeLabelEditor
          edgeId={editingEdge}
          currentValue={currentEdgeValue}
          onSave={saveEdgeStyle}
          onCancel={() => setEditingEdge(null)}
        />
      )}

      {showShortcuts && <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {showShareModal && diagramId && (
        <ShareDiagramModal
          diagramId={diagramId}
          existingToken={shareToken}
          onClose={() => setShowShareModal(false)}
          onTokenChange={setShareToken}
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
              <>
                {savedDiagrams.some((d) => d.isAuto) && (
                  <>
                    <p className="text-dim" style={{ marginBottom: 6, fontSize: 12 }}>
                      Auto-generated — regenerated automatically every time infrastructure data syncs
                    </p>
                    <div className="diagram-list">
                      {savedDiagrams
                        .filter((d) => d.isAuto)
                        .map((d) => (
                          <button key={d.id} className="diagram-list-item" onClick={() => loadDiagram(d)}>
                            <strong>
                              🔄 {d.name}
                            </strong>
                            <span className="diagram-list-meta">
                              {d.autoDescription} · updated {new Date(d.updatedAt).toLocaleString()} · {d.nodes.length} nodes
                            </span>
                          </button>
                        ))}
                    </div>
                  </>
                )}
                {savedDiagrams.some((d) => !d.isAuto) && (
                  <>
                    <p className="text-dim" style={{ margin: "14px 0 6px", fontSize: 12 }}>
                      Your saved diagrams
                    </p>
                    <div className="diagram-list">
                      {savedDiagrams
                        .filter((d) => !d.isAuto)
                        .map((d) => (
                          <div key={d.id} className="diagram-list-item-row">
                            <button className="diagram-list-item" onClick={() => loadDiagram(d)}>
                              <strong>{d.name}</strong>
                              <span className="diagram-list-meta">
                                {new Date(d.updatedAt).toLocaleString()} • {d.nodes.length} nodes
                              </span>
                            </button>
                            <button className="btn-sm" title="Version history" onClick={() => setHistoryDiagram({ id: d.id, name: d.name })}>
                              🕐
                            </button>
                          </div>
                        ))}
                    </div>
                  </>
                )}
              </>
            )}
            <div className="modal-actions">
              <button
                className="btn-secondary"
                onClick={async () => {
                  await apiFetch("/api/infra/diagrams/regenerate", { method: "POST" });
                  apiFetch("/api/infra/diagrams").then(setSavedDiagrams);
                }}
              >
                🔄 Regenerate auto diagrams now
              </button>
              <button className="btn-secondary" onClick={() => setShowLoadModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Version history — deliberately rendered after the Load modal (not
          alongside the other small modals earlier in this file) so it
          paints on top: two same-z-index .modal-overlay siblings stack by
          DOM order, and this one is opened FROM INSIDE the Load modal,
          which stays mounted underneath it. Confirmed live via a Playwright
          click landing on the wrong modal's content before this fix. */}
      {historyDiagram && (
        <DiagramVersionHistory
          diagramId={historyDiagram.id}
          diagramName={historyDiagram.name}
          onClose={() => setHistoryDiagram(null)}
          onRestored={async () => {
            const list = await apiFetch("/api/infra/diagrams");
            setSavedDiagrams(list);
            if (diagramId === historyDiagram.id) {
              const restored = list.find((d: SavedDiagram) => d.id === historyDiagram.id);
              if (restored) loadDiagram(restored);
            }
          }}
        />
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
