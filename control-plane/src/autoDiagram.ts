/**
 * Auto-generated architecture diagrams — regenerated in place every time
 * infrastructure data changes (see the call to regenerateAutoDiagrams() at
 * the end of every sync route in infraRoutes.ts), not just built once when
 * an admin happens to click a button.
 *
 * A real, extensible registry of "strategies" — each one answers a
 * different question an admin might have about the same underlying
 * resource graph: what's everything on one provider, what's everything
 * everywhere and how does it connect, what's in one account/project, what
 * categories of thing exist regardless of where they run. Adding another
 * way to slice the same data is just appending one more entry to
 * AUTO_DIAGRAM_STRATEGIES — nothing else has to change.
 *
 * Every node carries the resource's real properties (spread directly into
 * `data`), tags, region, account, and network info — not just a name and
 * an icon — so clicking a node in the interactive editor shows genuine
 * detail (NodePropertiesPanel.tsx renders it), the same rich data
 * `importFromDiscovery` in DiagramEditor.tsx now embeds for a manual
 * import too (this was a real, separate gap: neither path used to carry
 * this data at all).
 */

import dagre from "dagre";
import { infraAccounts, infraResources, getInfraAccount, type InfraResource, type InfraResourceType, type CloudProvider } from "./infraDiscovery.js";
import { upsertAutoDiagram, listSavedDiagrams, deleteSavedDiagram, type SavedDiagram } from "./diagramStore.js";

// ─── Shared icon/color lookup (mirrors web/src/pages/DiagramEditor.tsx's
// getIconForType/getColorForType — no shared package between control-plane
// and web in this project, so this is a deliberate, small, kept-in-sync-by-
// hand duplication rather than introducing shared-package infra for two
// ~15-line lookup tables) ────────────────────────────────────────────────

const ICONS: Record<string, string> = {
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
  elasticache: "⚡",
  "dynamodb-table": "📋",
  queue: "📬",
  cdn: "🌍",
};

const COLORS: Record<string, string> = {
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

const PROVIDER_COLOR: Record<string, string> = {
  aws: "#f97316",
  azure: "#3b82f6",
  gcp: "#22c55e",
  vmware: "#8b5cf6",
  proxmox: "#eab308",
  "on-prem": "#64748b",
  other: "#64748b",
};

// Category for the "by-type" strategy — "protocols or projects" from the
// original ask; project-shaped grouping is the by-account strategy below,
// this is the category/protocol-shaped one.
const CATEGORY_OF_TYPE: Record<string, string> = {
  vm: "Compute",
  container: "Compute",
  lambda: "Compute",
  "ecs-task": "Compute",
  "kubernetes-pod": "Compute",
  "esxi-host": "Compute",
  "proxmox-node": "Compute",
  "proxmox-vm": "Compute",
  "proxmox-container": "Compute",
  vpc: "Networking",
  subnet: "Networking",
  "security-group": "Networking",
  "load-balancer": "Networking",
  "nat-gateway": "Networking",
  "internet-gateway": "Networking",
  "route-table": "Networking",
  "vpn-gateway": "Networking",
  "transit-gateway": "Networking",
  "network-interface": "Networking",
  "elastic-ip": "Networking",
  vswitch: "Networking",
  "s3-bucket": "Storage",
  "ebs-volume": "Storage",
  efs: "Storage",
  "storage-account": "Storage",
  datastore: "Storage",
  "rds-instance": "Database",
  "rds-cluster": "Database",
  "dynamodb-table": "Database",
  elasticache: "Database",
};

function categoryOf(type: InfraResourceType): string {
  return CATEGORY_OF_TYPE[type] ?? "Other";
}

// ─── Node/edge construction ──────────────────────────────────────────────

export interface DiagramNode {
  id: string;
  type: "infra" | "group";
  position: { x: number; y: number };
  data: Record<string, unknown>;
  parentId?: string;
  extent?: "parent";
  style?: Record<string, unknown>;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  data: { label: string };
}

function nodeIdFor(r: InfraResource): string {
  return `node-${r.externalId || r.id}`;
}

// Full resource -> node.data mapping — properties spread directly in so
// NodePropertiesPanel's existing per-type fields (instanceType, engine,
// cidr, state, ...) are populated, plus tags/region/accountId/networkInfo
// for the panel's generic sections.
function resourceToNodeData(r: InfraResource): Record<string, unknown> {
  const account = getInfraAccount(r.accountId);
  return {
    label: r.name || r.externalId,
    icon: ICONS[r.type] ?? "",
    provider: r.provider,
    resourceType: r.type,
    color: COLORS[r.type] ?? PROVIDER_COLOR[r.provider] ?? "#5b8cff",
    region: r.region,
    accountId: r.accountId,
    accountName: account?.name,
    tags: r.tags ?? {},
    networkInfo: r.networkInfo ?? {},
    ...(r.properties ?? {}),
  };
}

// Groups a resource set into VPC-level containers (falls back to no
// grouping for resources without a VPC) and lays the whole thing out with
// dagre, mirroring web/src/components/diagram/autoLayout.ts's approach —
// same algorithm, server-side, since this runs at sync time rather than
// on-demand in the browser.
function buildDiagram(resources: InfraResource[]): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const nodeIds = new Set(resources.map(nodeIdFor));

  const vpcGroups = new Map<string, InfraResource[]>();
  const ungrouped: InfraResource[] = [];
  for (const r of resources) {
    if (r.type === "vpc") continue; // VPCs become the group container itself, not a member node
    const vpcId = r.networkInfo?.vpcId;
    if (vpcId && resources.some((x) => x.type === "vpc" && x.externalId === vpcId)) {
      if (!vpcGroups.has(vpcId)) vpcGroups.set(vpcId, []);
      vpcGroups.get(vpcId)!.push(r);
    } else {
      ungrouped.push(r);
    }
  }
  // A VPC present in this resource subset but with no members in it (e.g.
  // a "by-category" diagram scoped to just Networking, where the VPC's
  // actual children all fell into a different category) would otherwise
  // silently vanish — it's skipped as a container candidate above, and
  // never gets a group since nothing points to it. Render it as a plain
  // node instead of dropping it.
  for (const r of resources) {
    if (r.type === "vpc" && !vpcGroups.has(r.externalId)) ungrouped.push(r);
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 50, ranksep: 90 });

  const NODE_W = 180;
  const NODE_H = 60;

  for (const r of ungrouped) {
    g.setNode(nodeIdFor(r), { width: NODE_W, height: NODE_H });
  }
  // Members of a VPC group are laid out among themselves too (dagre
  // doesn't understand nesting, so each group's contents get their own
  // local layout below, not mixed into the top-level graph).
  for (const r of resources) {
    for (const rel of r.relationships) {
      const sourceId = nodeIdFor(r);
      const targetR = resources.find((x) => x.externalId === rel.targetResourceId);
      if (!targetR) continue;
      const targetId = nodeIdFor(targetR);
      if (nodeIds.has(sourceId) && nodeIds.has(targetId) && !vpcGroups.has(rel.targetResourceId)) {
        // only feed cross-group / ungrouped edges into the top-level graph;
        // within-group edges are still recorded for rendering, just not
        // used to influence the top-level layout.
      }
      edges.push({ id: `edge-${sourceId}-${targetId}`, source: sourceId, target: targetId, data: { label: rel.type } });
    }
  }
  for (const r of ungrouped) {
    for (const rel of r.relationships) {
      if (nodeIds.has(nodeIdFor(r)) && ungrouped.some((x) => x.externalId === rel.targetResourceId)) {
        g.setEdge(nodeIdFor(r), `node-${rel.targetResourceId}`);
      }
    }
  }

  dagre.layout(g);

  for (const r of ungrouped) {
    const pos = g.node(nodeIdFor(r));
    nodes.push({
      id: nodeIdFor(r),
      type: "infra",
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      data: resourceToNodeData(r),
    });
  }

  let groupY = Math.max(200, ...ungrouped.map(() => 0)) + 250;
  for (const [vpcId, members] of vpcGroups) {
    const vpcResource = resources.find((r) => r.type === "vpc" && r.externalId === vpcId);
    const groupId = `group-${vpcId}`;
    const cols = Math.min(4, members.length) || 1;
    const width = Math.max(400, cols * 200);
    const rows = Math.ceil(members.length / cols);
    const height = 80 + rows * 100;

    nodes.push({
      id: groupId,
      type: "group",
      position: { x: 50, y: groupY },
      data: {
        label: vpcResource?.name || vpcId,
        icon: "🌐",
        provider: vpcResource?.provider || members[0]?.provider,
        resourceType: "vpc",
        color: "#5b8cff",
        ...(vpcResource ? resourceToNodeData(vpcResource) : {}),
      },
      style: { width, height, backgroundColor: "rgba(91, 140, 255, 0.05)", borderRadius: 8, border: "2px dashed rgba(91, 140, 255, 0.3)" },
    });

    members.forEach((r, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      nodes.push({
        id: nodeIdFor(r),
        type: "infra",
        position: { x: 30 + col * 190, y: 60 + row * 100 },
        data: resourceToNodeData(r),
        parentId: groupId,
        extent: "parent",
      });
    });

    groupY += height + 60;
  }

  return { nodes, edges: edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)) };
}

// ─── Strategies ───────────────────────────────────────────────────────────

export interface GeneratedAutoDiagram {
  key: string;
  name: string;
  description: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface DiagramStrategy {
  id: string;
  label: string;
  description: string;
  generate: (resources: InfraResource[]) => GeneratedAutoDiagram[];
}

export const AUTO_DIAGRAM_STRATEGIES: DiagramStrategy[] = [
  {
    id: "all",
    label: "Everything, everywhere",
    description: "One diagram with every discovered resource across every provider/account, showing real cross-resource connections.",
    generate: (resources) => {
      if (resources.length === 0) return [];
      const { nodes, edges } = buildDiagram(resources);
      return [{ key: "auto:all", name: "Auto: All Infrastructure", description: "Every discovered resource, everywhere.", nodes, edges }];
    },
  },
  {
    id: "by-provider",
    label: "By provider",
    description: "One diagram per cloud/on-prem provider — \"what's everything on AWS\", \"what's everything on Azure\", etc.",
    generate: (resources) => {
      const providers = Array.from(new Set(resources.map((r) => r.provider)));
      return providers.map((provider) => {
        const subset = resources.filter((r) => r.provider === provider);
        const { nodes, edges } = buildDiagram(subset);
        return {
          key: `auto:by-provider:${provider}`,
          name: `Auto: ${providerLabel(provider)}`,
          description: `Every discovered resource on ${providerLabel(provider)}.`,
          nodes,
          edges,
        };
      });
    },
  },
  {
    id: "by-account",
    label: "By account / project",
    description: "One diagram per connected infrastructure account.",
    generate: (resources) => {
      const accountIds = Array.from(new Set(resources.map((r) => r.accountId)));
      return accountIds.map((accountId) => {
        const account = getInfraAccount(accountId);
        const subset = resources.filter((r) => r.accountId === accountId);
        const { nodes, edges } = buildDiagram(subset);
        return {
          key: `auto:by-account:${accountId}`,
          name: `Auto: ${account?.name ?? accountId}`,
          description: `Every discovered resource in the "${account?.name ?? accountId}" account.`,
          nodes,
          edges,
        };
      });
    },
  },
  {
    id: "by-category",
    label: "By category",
    description: "One diagram per resource category (Compute, Networking, Storage, Database, Other), regardless of provider or account.",
    generate: (resources) => {
      const categories = Array.from(new Set(resources.map((r) => categoryOf(r.type))));
      return categories.map((category) => {
        const subset = resources.filter((r) => categoryOf(r.type) === category);
        const { nodes, edges } = buildDiagram(subset);
        return {
          key: `auto:by-category:${category}`,
          name: `Auto: ${category}`,
          description: `Every discovered ${category.toLowerCase()} resource, across every provider and account.`,
          nodes,
          edges,
        };
      });
    },
  },
];

function providerLabel(provider: CloudProvider | string): string {
  const labels: Record<string, string> = { aws: "AWS", azure: "Azure", gcp: "GCP", vmware: "VMware", proxmox: "Proxmox", "on-prem": "On-Prem", other: "Other" };
  return labels[provider] ?? provider;
}

// ─── Regeneration ─────────────────────────────────────────────────────────

// Called after every sync (agent-reported or direct-API) so saved auto
// diagrams never go stale — each strategy's output is upserted by its
// stable key, so re-running never accumulates duplicates.
export function regenerateAutoDiagrams(): SavedDiagram[] {
  const results: SavedDiagram[] = [];
  const liveKeys = new Set<string>();
  for (const strategy of AUTO_DIAGRAM_STRATEGIES) {
    for (const generated of strategy.generate(infraResources)) {
      liveKeys.add(generated.key);
      results.push(upsertAutoDiagram(generated.key, generated.name, generated.description, generated.nodes, generated.edges));
    }
  }
  // Prune auto diagrams whose underlying account/provider/category no
  // longer produces any resources (e.g. the account was deleted) — an
  // upsert-only regeneration would otherwise leave these behind forever,
  // since nothing else ever revisits an autoKey that stopped being
  // generated. Snapshot the list before deleting from it — deleteSavedDiagram
  // splices the very array listSavedDiagrams() returns, so deleting while
  // iterating it directly silently skips whichever entry shifts into the
  // just-vacated index (confirmed live: two stale diagrams survived a prune
  // that should have removed everything, because they landed on skipped
  // indices — not caught by inspection, only by watching it actually happen).
  const staleIds = listSavedDiagrams()
    .filter((d) => d.isAuto && d.autoKey && !liveKeys.has(d.autoKey))
    .map((d) => d.id);
  for (const id of staleIds) deleteSavedDiagram(id);
  return results;
}
