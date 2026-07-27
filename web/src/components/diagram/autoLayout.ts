/**
 * Real auto-layout for the diagram canvas, using dagre (the standard
 * hierarchical-DAG layout library React Flow's own docs recommend pairing
 * it with) — not a placeholder. Positions nodes left-to-right by
 * dependency order derived from the actual edges, so a freshly-imported
 * or auto-generated diagram is immediately readable instead of a pile of
 * overlapping nodes at (0,0).
 */
import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;
const GROUP_PADDING = 40;

export function layoutNodes(nodes: Node[], edges: Edge[], direction: "LR" | "TB" = "LR"): Node[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 50, ranksep: 90 });

  // Group nodes (subgraph containers, e.g. a VPC) get laid out around
  // their children rather than as regular nodes themselves — dagre lays
  // out flat graphs, so group nodes are sized/positioned after the fact
  // from their children's bounding box instead of being fed into dagre.
  const groupIds = new Set(nodes.filter((n) => n.type === "group").map((n) => n.id));
  const plainNodes = nodes.filter((n) => !groupIds.has(n.id));

  for (const node of plainNodes) {
    g.setNode(node.id, { width: node.width ?? NODE_WIDTH, height: node.height ?? NODE_HEIGHT });
  }
  for (const edge of edges) {
    if (!groupIds.has(edge.source) && !groupIds.has(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  const positioned = new Map<string, { x: number; y: number }>();
  for (const node of plainNodes) {
    const pos = g.node(node.id);
    positioned.set(node.id, { x: pos.x - (node.width ?? NODE_WIDTH) / 2, y: pos.y - (node.height ?? NODE_HEIGHT) / 2 });
  }

  const result = nodes.map((node) => {
    if (positioned.has(node.id)) {
      return { ...node, position: positioned.get(node.id)! };
    }
    return node;
  });

  // Size/position group containers from their children's bounding box.
  for (const group of result.filter((n) => n.type === "group")) {
    const children = result.filter((n) => n.parentId === group.id);
    if (children.length === 0) continue;
    const minX = Math.min(...children.map((c) => c.position.x)) - GROUP_PADDING;
    const minY = Math.min(...children.map((c) => c.position.y)) - GROUP_PADDING - 30; // extra top padding for the group label
    const maxX = Math.max(...children.map((c) => c.position.x + (c.width ?? NODE_WIDTH))) + GROUP_PADDING;
    const maxY = Math.max(...children.map((c) => c.position.y + (c.height ?? NODE_HEIGHT))) + GROUP_PADDING;
    group.position = { x: minX, y: minY };
    group.style = { ...group.style, width: maxX - minX, height: maxY - minY };
    for (const child of children) {
      child.position = { x: child.position.x - minX, y: child.position.y - minY };
    }
  }

  return result;
}
