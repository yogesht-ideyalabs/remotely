/**
 * Enhanced Layout Engine — Scanopy-inspired multi-algorithm approach
 *
 * Different layout algorithms for different diagram view types:
 *
 * | View Type      | Algorithm               | Direction | Why                                    |
 * |----------------|-------------------------|-----------|----------------------------------------|
 * | Network (L3)   | Hierarchical (Sugiyama)  | TB        | VPCs → Subnets → Resources flows down  |
 * | Physical (L2)  | Hierarchical (Sugiyama)  | LR        | Switch-port layout, L→R for readability |
 * | Workloads      | Hierarchical + Compound  | TB        | Host → VM → Container nesting          |
 * | Applications   | Rect-packing + overlay   | —         | Service groups tiled by size           |
 * | All-in-one     | Hierarchical             | LR        | General-purpose mixed view             |
 *
 * Key principles (from Scanopy's blog "Making Network Topology Readable"):
 * 1. Containment replaces edges — parent-child = nesting, not a line
 * 2. One layout-driving edge type per view; other rels are thin context edges
 * 3. Deterministic: same data → same layout (fixed seed, stable sort)
 * 4. Edge-crossing minimization as explicit constraint (Sugiyama's strength)
 * 5. C4-style zoom levels orthogonal to view selection
 *
 * Author: Yogesh Tiwari
 */

import dagre from "dagre";

export type LayoutViewType = "network" | "physical" | "workloads" | "applications" | "all";
export type ZoomLevel = "context" | "container" | "component" | "detail";

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  parentId?: string;      // For compound/nested layout
  group?: string;         // For rect-packing grouping
  priority?: number;      // Higher = placed earlier (more central)
}

export interface LayoutEdge {
  source: string;
  target: string;
  weight?: number;        // Higher weight = stronger pull toward same rank
  isContextEdge?: boolean; // Context edges don't drive layout, just render
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  groupBounds?: Map<string, { x: number; y: number; width: number; height: number }>;
}

export interface LayoutOptions {
  viewType: LayoutViewType;
  zoomLevel?: ZoomLevel;
  nodeWidth?: number;
  nodeHeight?: number;
  nodeSeparation?: number;
  rankSeparation?: number;
  // Deterministic seeding (Scanopy principle: same data → same diagram)
  seed?: number;
}

/**
 * Main entry point — selects layout algorithm based on view type.
 */
export function computeLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions
): LayoutResult {
  const nodeWidth = options.nodeWidth || 180;
  const nodeHeight = options.nodeHeight || 60;
  const nodeSep = options.nodeSeparation || 50;
  const rankSep = options.rankSeparation || 90;

  switch (options.viewType) {
    case "network":
      return hierarchicalLayout(nodes, edges, {
        direction: "TB",
        nodeWidth, nodeHeight, nodeSep, rankSep,
        compoundGroups: true,
      });

    case "physical":
      return hierarchicalLayout(nodes, edges, {
        direction: "LR",
        nodeWidth, nodeHeight, nodeSep: nodeSep * 0.8, rankSep,
        compoundGroups: false,
      });

    case "workloads":
      return hierarchicalLayout(nodes, edges, {
        direction: "TB",
        nodeWidth, nodeHeight, nodeSep, rankSep: rankSep * 1.2,
        compoundGroups: true,
      });

    case "applications":
      return applicationLayout(nodes, edges, { nodeWidth, nodeHeight, nodeSep });

    case "all":
    default:
      return hierarchicalLayout(nodes, edges, {
        direction: "LR",
        nodeWidth, nodeHeight, nodeSep, rankSep,
        compoundGroups: true,
      });
  }
}

// ─── Hierarchical (Sugiyama) Layout ──────────────────────────────────────────
// Used for Network/L3, Physical/L2, Workloads, and All-in-one.
// Dagre implements the Sugiyama framework (layer assignment, crossing reduction,
// node placement) — the same family as ELK's layered algorithm.

interface HierarchicalOptions {
  direction: "TB" | "LR" | "BT" | "RL";
  nodeWidth: number;
  nodeHeight: number;
  nodeSep: number;
  rankSep: number;
  compoundGroups: boolean;
}

function hierarchicalLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: HierarchicalOptions
): LayoutResult {
  const g = new dagre.graphlib.Graph({ compound: opts.compoundGroups });
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: opts.direction,
    nodesep: opts.nodeSep,
    ranksep: opts.rankSep,
    marginx: 40,
    marginy: 40,
  });

  // Sort nodes deterministically (Scanopy principle)
  const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));

  // Add nodes
  for (const node of sortedNodes) {
    g.setNode(node.id, { width: node.width, height: node.height });
  }

  // Set parent-child (compound) relationships
  if (opts.compoundGroups) {
    for (const node of sortedNodes) {
      if (node.parentId && g.hasNode(node.parentId)) {
        g.setParent(node.id, node.parentId);
      }
    }
  }

  // Add edges (only layout-driving ones, not context edges)
  const sortedEdges = [...edges]
    .filter((e) => !e.isContextEdge)
    .sort((a, b) => `${a.source}-${a.target}`.localeCompare(`${b.source}-${b.target}`));

  for (const edge of sortedEdges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target, { weight: edge.weight || 1 });
    }
  }

  // Run Dagre layout
  dagre.layout(g);

  // Extract positions
  const positions = new Map<string, { x: number; y: number }>();
  const groupBounds = new Map<string, { x: number; y: number; width: number; height: number }>();

  for (const nodeId of g.nodes()) {
    const layoutNode = g.node(nodeId);
    if (layoutNode) {
      positions.set(nodeId, {
        x: layoutNode.x - (layoutNode.width || opts.nodeWidth) / 2,
        y: layoutNode.y - (layoutNode.height || opts.nodeHeight) / 2,
      });
    }
  }

  // Calculate group bounds for compound nodes
  if (opts.compoundGroups) {
    for (const node of sortedNodes) {
      const children = g.children(node.id);
      if (children && children.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const childId of children) {
          const pos = positions.get(childId);
          const childNode = sortedNodes.find((n) => n.id === childId);
          if (pos && childNode) {
            minX = Math.min(minX, pos.x);
            minY = Math.min(minY, pos.y);
            maxX = Math.max(maxX, pos.x + childNode.width);
            maxY = Math.max(maxY, pos.y + childNode.height);
          }
        }
        if (minX !== Infinity) {
          const padding = 40;
          groupBounds.set(node.id, {
            x: minX - padding,
            y: minY - padding - 30, // Extra top for label
            width: (maxX - minX) + padding * 2,
            height: (maxY - minY) + padding * 2 + 30,
          });
        }
      }
    }
  }

  return { positions, groupBounds };
}

// ─── Application/Service Layout ──────────────────────────────────────────────
// Tiles service groups by area (rect-packing) with dependency edges as an
// overlay that doesn't drive placement — matches Scanopy's "Applications view
// uses ELK rectpacking" approach.

function applicationLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: { nodeWidth: number; nodeHeight: number; nodeSep: number }
): LayoutResult {
  const positions = new Map<string, { x: number; y: number }>();
  const groupBounds = new Map<string, { x: number; y: number; width: number; height: number }>();

  // Group nodes by their `group` property
  const groups = new Map<string, LayoutNode[]>();
  const ungrouped: LayoutNode[] = [];

  for (const node of nodes) {
    const groupKey = node.group || "__ungrouped";
    if (groupKey === "__ungrouped") {
      ungrouped.push(node);
    } else {
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey)!.push(node);
    }
  }

  // Calculate group sizes (for packing) — sort largest first (shelf-packing heuristic)
  const groupEntries = [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length
  );

  // Simple rect-packing: arrange groups in rows, wrapping when row gets too wide
  const maxRowWidth = Math.max(1200, Math.sqrt(nodes.length) * opts.nodeWidth * 1.5);
  let currentX = 0;
  let currentY = 0;
  let rowMaxHeight = 0;

  for (const [groupId, groupNodes] of groupEntries) {
    // Layout nodes within the group as a small grid
    const cols = Math.ceil(Math.sqrt(groupNodes.length));
    const groupWidth = cols * (opts.nodeWidth + opts.nodeSep) + opts.nodeSep;
    const rows = Math.ceil(groupNodes.length / cols);
    const groupHeight = rows * (opts.nodeHeight + opts.nodeSep) + opts.nodeSep + 40; // +40 for label

    // Check if group fits in current row
    if (currentX + groupWidth > maxRowWidth && currentX > 0) {
      currentX = 0;
      currentY += rowMaxHeight + opts.nodeSep * 2;
      rowMaxHeight = 0;
    }

    // Place group
    groupBounds.set(groupId, {
      x: currentX,
      y: currentY,
      width: groupWidth,
      height: groupHeight,
    });

    // Place nodes within group
    let col = 0;
    let row = 0;
    for (const node of groupNodes) {
      positions.set(node.id, {
        x: currentX + opts.nodeSep + col * (opts.nodeWidth + opts.nodeSep),
        y: currentY + 40 + opts.nodeSep + row * (opts.nodeHeight + opts.nodeSep),
      });
      col++;
      if (col >= cols) { col = 0; row++; }
    }

    currentX += groupWidth + opts.nodeSep * 2;
    rowMaxHeight = Math.max(rowMaxHeight, groupHeight);
  }

  // Place ungrouped nodes below all groups
  if (ungrouped.length > 0) {
    const startY = currentY + rowMaxHeight + opts.nodeSep * 3;
    let col = 0;
    const cols = Math.ceil(Math.sqrt(ungrouped.length));
    let row = 0;
    for (const node of ungrouped) {
      positions.set(node.id, {
        x: opts.nodeSep + col * (opts.nodeWidth + opts.nodeSep),
        y: startY + row * (opts.nodeHeight + opts.nodeSep),
      });
      col++;
      if (col >= cols) { col = 0; row++; }
    }
  }

  return { positions, groupBounds };
}

/**
 * Utility: Given React Flow nodes + edges, apply layout and return updated positions.
 * This bridges the layout engine to the diagram editor's format.
 */
export function applyLayoutToReactFlowNodes(
  nodes: { id: string; type?: string; data?: Record<string, unknown>; parentId?: string }[],
  edges: { source: string; target: string; data?: Record<string, unknown> }[],
  viewType: LayoutViewType
): Map<string, { x: number; y: number }> {
  const layoutNodes: LayoutNode[] = nodes.map((n) => ({
    id: n.id,
    width: n.type === "group" ? 400 : 180,
    height: n.type === "group" ? 300 : 60,
    parentId: n.parentId,
    group: (n.data as Record<string, unknown>)?.appGroup as string | undefined,
  }));

  const layoutEdges: LayoutEdge[] = edges.map((e) => ({
    source: e.source,
    target: e.target,
    isContextEdge: (e.data as Record<string, unknown>)?.isContext === true,
  }));

  const result = computeLayout(layoutNodes, layoutEdges, { viewType });
  return result.positions;
}
