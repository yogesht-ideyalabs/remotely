/**
 * Architecture — a dedicated, read-focused page that shows the auto-generated
 * infrastructure diagrams (see control-plane/src/autoDiagram.ts) grouped by
 * "how do you want to slice it": by project/account, by provider, by
 * category, or everything at once and how it's all interconnected. Click any
 * node for full detail (tags, region, VPC, inbound/outbound ports) via the
 * same NodePropertiesPanel used in the interactive Diagram Editor.
 *
 * Unlike the Diagram Editor, this page is not for drawing — it's always the
 * live picture of whatever infrastructure is currently discovered, and
 * regenerates automatically every time a sync happens.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../Icon";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { apiFetch, fetchUsers, fetchConnectionAccessSummary, fetchUserReachableResources } from "../api";
import { InfraNode } from "../components/diagram/InfraNode";
import { GroupNode } from "../components/diagram/GroupNode";
import { NodePropertiesPanel } from "../components/diagram/NodePropertiesPanel";

const nodeTypes: NodeTypes = { infra: InfraNode, group: GroupNode };

interface AutoDiagram {
  id: string;
  name: string;
  autoKey?: string;
  autoDescription?: string;
  isAuto: boolean;
  updatedAt: number;
  nodes: Node[];
  edges: Edge[];
}

interface Strategy {
  id: string;
  label: string;
  description: string;
}

function strategyIdOf(autoKey: string | undefined): string {
  if (!autoKey) return "other";
  if (autoKey === "auto:all") return "all";
  return autoKey.split(":")[1] || "other";
}

function ArchitectureInner() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [diagrams, setDiagrams] = useState<AutoDiagram[]>([]);
  const [activeStrategy, setActiveStrategy] = useState<string>("by-account");
  const [activeDiagramId, setActiveDiagramId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState("");

  // Access-aware diagrams + blast radius — both read off the same
  // linkedConnectionId a node may carry (see NodePropertiesPanel.tsx's
  // AccessSection for where that link is actually set).
  const [usernames, setUsernames] = useState<string[]>([]);
  const [blastRadiusUser, setBlastRadiusUser] = useState("");
  const [reachableIds, setReachableIds] = useState<Set<string> | null>(null);
  const [accessBadges, setAccessBadges] = useState<Map<string, { canAccessCount: number; hasRecentDenial: boolean }>>(new Map());

  useEffect(() => {
    fetchUsers()
      .then((users) => setUsernames(users.map((u) => u.username)))
      .catch(() => setUsernames([]));
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [strategyList, diagramList] = await Promise.all([
        apiFetch("/api/infra/diagram-strategies"),
        apiFetch("/api/infra/diagrams"),
      ]);
      setStrategies(strategyList);
      setDiagrams(diagramList.filter((d: AutoDiagram) => d.isAuto));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const regenerate = useCallback(async () => {
    setLoading(true);
    try {
      await apiFetch("/api/infra/diagrams/regenerate", { method: "POST" });
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loadAll]);

  const seedDemo = useCallback(async () => {
    setSeeding(true);
    setError("");
    try {
      await apiFetch("/api/infra/seed-demo", { method: "POST" });
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSeeding(false);
    }
  }, [loadAll]);

  const diagramsByStrategy = useMemo(() => {
    const map = new Map<string, AutoDiagram[]>();
    for (const d of diagrams) {
      const sid = strategyIdOf(d.autoKey);
      if (!map.has(sid)) map.set(sid, []);
      map.get(sid)!.push(d);
    }
    return map;
  }, [diagrams]);

  const tabsForActiveStrategy = diagramsByStrategy.get(activeStrategy) ?? [];

  // Keep a valid diagram selected whenever the strategy or data changes.
  useEffect(() => {
    if (tabsForActiveStrategy.length === 0) {
      setActiveDiagramId(null);
      return;
    }
    if (!tabsForActiveStrategy.some((d) => d.id === activeDiagramId)) {
      setActiveDiagramId(tabsForActiveStrategy[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStrategy, diagrams]);

  const activeDiagram = tabsForActiveStrategy.find((d) => d.id === activeDiagramId) ?? null;

  // Blast radius: fetch what the selected user can actually reach whenever
  // they change (or clear the highlight entirely when nobody's selected).
  useEffect(() => {
    if (!blastRadiusUser) {
      setReachableIds(null);
      return;
    }
    let cancelled = false;
    fetchUserReachableResources(blastRadiusUser)
      .then((r) => {
        if (!cancelled) setReachableIds(new Set(r.resourceIds));
      })
      .catch(() => {
        if (!cancelled) setReachableIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [blastRadiusUser]);

  // Access-aware badges: for every distinct Connection a node in the
  // *current* diagram is linked to, fetch its access summary once. Cheap
  // at this scale (a handful of linked nodes per diagram, not one call per
  // node) — re-runs whenever the diagram changes or a link/unlink reloads it.
  useEffect(() => {
    const linkedIds = new Set(
      (activeDiagram?.nodes ?? [])
        .map((n) => (n.data as { linkedConnectionId?: string }).linkedConnectionId)
        .filter((id): id is string => Boolean(id))
    );
    if (linkedIds.size === 0) {
      setAccessBadges(new Map());
      return;
    }
    let cancelled = false;
    Promise.all(
      Array.from(linkedIds).map((id) =>
        fetchConnectionAccessSummary(id)
          .then((s) => [id, { canAccessCount: s.canAccess.length, hasRecentDenial: s.recentDenials.length > 0 }] as const)
          .catch(() => [id, { canAccessCount: 0, hasRecentDenial: false }] as const)
      )
    ).then((entries) => {
      if (!cancelled) setAccessBadges(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [activeDiagram]);

  // The nodes actually handed to React Flow — activeDiagram.nodes patched
  // with the access badge / blast-radius reachability computed above, same
  // per-node-flag pattern the app already uses for things like data.locked.
  const displayNodes = useMemo(() => {
    if (!activeDiagram) return [];
    return activeDiagram.nodes.map((n) => {
      if (n.type !== "infra") return n;
      const linkedId = (n.data as { linkedConnectionId?: string }).linkedConnectionId;
      return {
        ...n,
        data: {
          ...n.data,
          accessBadge: linkedId ? accessBadges.get(linkedId) : undefined,
          reachable: blastRadiusUser ? Boolean(linkedId && reachableIds?.has(linkedId)) : undefined,
        },
      };
    });
  }, [activeDiagram, accessBadges, blastRadiusUser, reachableIds]);

  const selectedNode = selectedNodeId ? displayNodes.find((n) => n.id === selectedNodeId) ?? null : null;

  return (
    <div className="architecture-page">
      <div className="page-header">
        <h1><Icon name="layers" size={22} /> Architecture</h1>
        <p className="subtitle">
          Live, auto-generated architecture built from every discovered resource — regenerates
          automatically whenever infrastructure syncs. Click any node for full detail.
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="architecture-toolbar">
        <div className="strategy-tabs">
          {strategies.map((s) => (
            <button
              key={s.id}
              className={`strategy-tab ${activeStrategy === s.id ? "active" : ""}`}
              title={s.description}
              onClick={() => setActiveStrategy(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="architecture-actions">
          <select
            value={blastRadiusUser}
            onChange={(e) => setBlastRadiusUser(e.target.value)}
            title="Blast radius — highlight every linked resource this user can reach"
            style={{ width: "auto" }}
          >
            <option value="">Blast radius: off</option>
            {usernames.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <button className="btn-secondary" onClick={regenerate} disabled={loading}>
            🔄 Regenerate now
          </button>
          <button className="btn-secondary" onClick={seedDemo} disabled={seeding}>
            {seeding ? "Loading demo data…" : "🌱 Load demo multi-cloud data"}
          </button>
        </div>
      </div>

      {diagrams.length === 0 && !loading && (
        <div className="empty-state architecture-empty">
          <p>
            No infrastructure has been discovered yet, so there's nothing to draw. Add an
            infrastructure account and sync it from the{" "}
            <a href="/admin/infra-map">Infrastructure Map</a>, or click{" "}
            <strong>"Load demo multi-cloud data"</strong> above to populate three example
            projects — project-aws, project-azure, and project-gcp — with realistic resources so
            you can see how this page works.
          </p>
        </div>
      )}

      {tabsForActiveStrategy.length > 0 && (
        <div className="diagram-subtabs">
          {tabsForActiveStrategy.map((d) => (
            <button
              key={d.id}
              className={`diagram-subtab ${activeDiagramId === d.id ? "active" : ""}`}
              onClick={() => {
                setActiveDiagramId(d.id);
                setSelectedNodeId(null);
              }}
            >
              {d.name.replace(/^Auto:\s*/, "")}
              <span className="diagram-subtab-count">{d.nodes.filter((n) => n.type === "infra").length}</span>
            </button>
          ))}
        </div>
      )}

      {activeDiagram && (
        <div className="architecture-body">
          <div className="architecture-canvas">
            <ReactFlow
              nodes={displayNodes}
              edges={activeDiagram.edges}
              nodeTypes={nodeTypes}
              onNodeClick={(_, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              colorMode="dark"
              proOptions={{ hideAttribution: true }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              fitView
              fitViewOptions={{ padding: 0.2 }}
            >
              <Controls showInteractive={false} />
              <MiniMap
                nodeStrokeColor="#5b8cff"
                nodeColor={(n) => (n.type === "group" ? "rgba(91,140,255,0.1)" : "#1e2433")}
                maskColor="rgba(0,0,0,0.7)"
              />
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#2a3040" />
            </ReactFlow>
          </div>

          {selectedNode && (
            <NodePropertiesPanel
              node={selectedNode}
              allNodes={displayNodes}
              edges={activeDiagram.edges}
              onUpdate={() => {}}
              onClose={() => setSelectedNodeId(null)}
              onResourceLinked={loadAll}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function Architecture() {
  return (
    <ReactFlowProvider>
      <ArchitectureInner />
    </ReactFlowProvider>
  );
}
