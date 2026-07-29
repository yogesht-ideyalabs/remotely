# Network segmentation diagram strategy ("By network")

**Status:** live
**Date:** 2026-07-29

## Context

While comparing Remotely against Scanopy's "four structural views" concept
(L2 physical / L3 logical / workload nesting / application dependency), we
initially assumed multi-perspective diagramming was a gap. On inspection it
mostly isn't: `autoDiagram.ts`'s `AUTO_DIAGRAM_STRATEGIES` registry already
has a `by-workload` strategy (bare-metal → VM → container, matching
Scanopy's "Workloads" view) and a `by-application` strategy that rolls
cross-resource edges up into real app-to-app dependency edges (matching
Scanopy's "Applications" view) — both genuinely different graph
transformations, not just relabeled groupings.

The one real, closeable gap: an **L3 logical / subnet-segmentation** view
(VPC → subnet → resource nesting, public vs. private subnet distinction,
IGW/NAT attachment) already exists — but only as a static Mermaid diagram
on the separate "Infrastructure Map" page (`generateMermaidNetwork` in
`infraDiscovery.ts`), not as an interactive strategy in the
Architecture/Diagram Editor's node/edge system. L2 physical topology
(switch/port/VLAN-level) is a genuine gap, but it's a missing *discovery
source* (no SNMP/LLDP), not a missing view — out of scope here, tracked
separately.

## Design

Port `generateMermaidNetwork`'s already-proven VPC→subnet→resource logic
into a new `by-network` entry in `AUTO_DIAGRAM_STRATEGIES`, producing real
`DiagramNode`/`DiagramEdge` objects instead of a Mermaid string, so it's
interactive (draggable, clickable → `NodePropertiesPanel`) like every other
strategy, not view-only.

Two-level nesting (VPC group containing subnet sub-groups containing
resource nodes) is new — every existing strategy only nests one level deep.
Confirmed the frontend already supports this: `parentId` is a generic
React Flow mechanism with no hardcoded depth limit, `GroupNode.tsx` doesn't
assume it's a top-level group.

Per VPC: one outer group node (label + CIDR from `properties.cidr`,
matching the Mermaid version). Per subnet within that VPC: one nested group
node, positioned in the VPC's local coordinate space, colored/iconed by
`properties.public` (public vs. private — the same distinction the Mermaid
version already draws). Member resources (`networkInfo.subnetId` match)
nest inside their subnet group, positioned in the subnet's local space.
IGW/NAT gateways attach directly to the VPC (not inside any subnet),
matching the Mermaid version. Resources with no VPC at all fall into an
"External / Global" bucket, same as the Mermaid version's `noVpc` handling.
Edges reuse each resource's real `relationships` array, filtered to pairs
present in the diagram — same approach `buildDiagram` already uses, no new
edge semantics invented.

## Files touched

- `control-plane/src/autoDiagram.ts` — new `by-network` strategy + a
  `buildNetworkDiagram` helper (two-level nested grouping)
- `web/src/pages/Features.tsx` — added as a new tracked, live entry under
  "Infrastructure & Diagrams" (it wasn't previously listed at all)

## Verification

- `npx tsc -b` clean on control-plane.
- Live: regenerated diagrams via `POST /api/infra/diagrams/regenerate`
  against the real seeded demo data, confirmed the `by-network` diagram
  exists with 35 nodes / 16 edges spanning all three cloud providers
  (AWS/Azure/GCP), correct two-level nesting (VPC group → subnet group →
  resource node), and each resource node carries a full real data payload
  (`resourceId`, `instanceType`, `ami`, `state`, etc.) — confirming
  `NodePropertiesPanel` would render real detail, not a static label.
- **Caught and fixed a real bug during this verification**: the first
  version spread `resourceToNodeData(...)` *after* setting the custom
  label/icon/color, so the generic per-type lookup silently overwrote the
  public/private subnet distinction (every subnet rendered the same
  generic "📡" icon) and the VPC's CIDR label suffix. Reordering the
  spread to come first fixed both — re-verified live: public subnets now
  show 🌍/green, private subnets show 🔒/gray, VPC labels include their
  real CIDR block.
- Confirmed existing strategies are unaffected — this only added a new
  registry entry, `npx tsc -b` stayed clean throughout.
