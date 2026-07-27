/**
 * Express routes for the Infrastructure Discovery & Diagram feature.
 * 
 * Endpoints:
 * - GET    /api/infra/accounts          - List configured infrastructure accounts
 * - POST   /api/infra/accounts          - Add a new infrastructure account
 * - PUT    /api/infra/accounts/:id      - Update an account
 * - DELETE /api/infra/accounts/:id      - Remove an account
 * - GET    /api/infra/resources         - List discovered resources (with filters)
 * - POST   /api/infra/resources/sync    - Trigger a sync (or accept agent-reported data)
 * - POST   /api/infra/diagram           - Generate a diagram
 * - GET    /api/infra/summary           - Get infrastructure summary/stats
 */

import { Router, type Request, type Response } from "express";
import { requireAuth, requireAnyAdmin, type AuthedRequest } from "./auth.js";
import { logAudit } from "./store.js";
import {
  listInfraAccounts,
  getInfraAccount,
  createInfraAccount,
  updateInfraAccount,
  deleteInfraAccount,
  listInfraResources,
  upsertInfraResources,
  pruneStaleResources,
  generateDiagram,
  getInfraSummary,
  type CloudProvider,
  type DiagramOptions,
  type InfraResourceType,
} from "./infraDiscovery.js";
import { loadTable, saveRow, deleteRow } from "./db.js";
import { seedDemoInfra } from "./demoSeed.js";
import { broadcastToDiagramViewers } from "./state.js";

export const infraRouter = Router();

// All infra routes require authentication AND admin/delegated-admin —
// matches the frontend, which only ever renders "Infrastructure Map" and
// "Diagram Editor" in AdminMenu.tsx for anyAdmin. Without this, a plain
// user could bypass the hidden nav entirely and hit these endpoints
// directly (list every discovered resource, add/remove cloud accounts,
// trigger real AWS/Azure/GCP syncs) — the UI hiding it isn't enforcement.
infraRouter.use(requireAuth, requireAnyAdmin);

// ─── Accounts ────────────────────────────────────────────────────────────────

infraRouter.get("/accounts", (req: Request, res: Response) => {
  const accounts = listInfraAccounts();
  res.json(accounts);
});

infraRouter.post("/accounts", (req: Request, res: Response) => {
  const authReq = req as AuthedRequest;
  const { name, provider, accountId, regions, accessMode, agentIds, credentialRef, enabled } = req.body;

  if (!name || !provider || !accountId) {
    res.status(400).json({ error: "name, provider, and accountId are required" });
    return;
  }

  const account = createInfraAccount({
    name,
    provider: provider as CloudProvider,
    accountId,
    regions: regions || [],
    accessMode: accessMode || "agent",
    agentIds: agentIds || [],
    credentialRef,
    enabled: enabled !== false,
    createdBy: authReq.user!.sub,
  });

  logAudit(authReq.user!.sub, "infra_account_created", account.id, `Created infra account: ${name} (${provider})`);
  res.status(201).json(account);
});

infraRouter.put("/accounts/:id", (req: Request, res: Response) => {
  const authReq = req as AuthedRequest;
  const { id } = req.params;
  const changes = req.body;

  const updated = updateInfraAccount(id, changes);
  if (!updated) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  logAudit(authReq.user!.sub, "infra_account_updated", id, `Updated infra account: ${updated.name}`);
  res.json(updated);
});

infraRouter.delete("/accounts/:id", (req: Request, res: Response) => {
  const authReq = req as AuthedRequest;
  const { id } = req.params;
  const account = getInfraAccount(id);

  if (!deleteInfraAccount(id)) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  logAudit(authReq.user!.sub, "infra_account_deleted", id, `Deleted infra account: ${account?.name}`);
  regenerateAutoDiagrams();
  res.json({ ok: true });
});

// ─── Resources ───────────────────────────────────────────────────────────────

infraRouter.get("/resources", (req: Request, res: Response) => {
  const { accountId, provider, region, type } = req.query;
  const resources = listInfraResources({
    accountId: accountId as string | undefined,
    provider: provider as CloudProvider | undefined,
    region: region as string | undefined,
    type: type as InfraResourceType | undefined,
  });
  res.json(resources);
});

/**
 * Accept infrastructure data from an agent or trigger an API-based sync.
 * 
 * Body for agent-reported data:
 * {
 *   accountId: string,
 *   region: string,
 *   resources: InfraResource[] (without id, accountId, discoveredAt),
 *   pruneStale: boolean (if true, removes resources not in this batch)
 * }
 */
infraRouter.post("/resources/sync", (req: Request, res: Response) => {
  const authReq = req as AuthedRequest;
  const { accountId, region, resources, pruneStale } = req.body;

  if (!accountId || !resources || !Array.isArray(resources)) {
    res.status(400).json({ error: "accountId and resources[] are required" });
    return;
  }

  const account = getInfraAccount(accountId);
  if (!account) {
    res.status(404).json({ error: "Infrastructure account not found" });
    return;
  }

  const { created, updated } = upsertInfraResources(accountId, resources);
  let pruned = 0;

  if (pruneStale && region) {
    const currentIds = resources.map((r: { externalId: string }) => r.externalId);
    pruned = pruneStaleResources(accountId, region, currentIds);
  }

  logAudit(
    authReq.user!.sub,
    "infra_sync_completed",
    accountId,
    `Synced ${created} new, ${updated} updated, ${pruned} pruned resources for ${account.name} (${region || "all regions"})`
  );

  // Auto-generated diagrams (by-provider/by-account/by-category/all) never
  // go stale — regenerated in place on every sync, agent-reported or
  // direct-API, not just when an admin happens to open the diagram editor.
  regenerateAutoDiagrams();

  res.json({ created, updated, pruned });
});

// ─── Diagram Generation ──────────────────────────────────────────────────────

infraRouter.post("/diagram", (req: Request, res: Response) => {
  const options: DiagramOptions = {
    format: req.body.format || "mermaid",
    scope: req.body.scope || "all",
    scopeId: req.body.scopeId,
    diagramType: req.body.diagramType || "architecture",
    includeTypes: req.body.includeTypes,
    excludeTypes: req.body.excludeTypes,
    groupBy: req.body.groupBy || "account",
  };

  const diagrams = generateDiagram(options);
  res.json({ diagrams });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

infraRouter.get("/summary", (_req: Request, res: Response) => {
  const summary = getInfraSummary();
  res.json(summary);
});

// ─── Demo Seed Data ──────────────────────────────────────────────────────────

infraRouter.post("/seed-demo", (req: Request, res: Response) => {
  const authReq = req as AuthedRequest;
  const result = seedDemoInfra(authReq.user!.sub);
  logAudit(
    authReq.user!.sub,
    "infra_demo_seeded",
    null,
    `Demo infra seeded: ${result.createdAccounts.join(", ") || "none"} (${result.totalResourcesCreated} resources); skipped ${result.skippedAccounts.join(", ") || "none"}`
  );
  regenerateAutoDiagrams();
  res.json(result);
});

// ─── Cloud Sync (Direct API Mode) ───────────────────────────────────────────

/**
 * Trigger a cloud sync for a specific account.
 * The control plane calls the cloud provider APIs directly using stored credentials.
 */
infraRouter.post("/accounts/:id/sync", async (req: Request, res: Response) => {
  const authReq = req as AuthedRequest;
  const { id } = req.params;
  const account = getInfraAccount(id);

  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  if (account.accessMode !== "api") {
    res.status(400).json({ error: "Account is configured for agent-based discovery, not direct API sync" });
    return;
  }

  const roleArn = req.body.roleArn || account.credentialRef || "";
  const regions = req.body.regions || account.regions;

  if (!roleArn) {
    res.status(400).json({ error: "roleArn is required for AWS direct sync" });
    return;
  }

  if (account.provider === "aws") {
    const result = await syncAwsAccount(account, {
      roleArn,
      externalId: req.body.externalId,
      regions: regions.length > 0 ? regions : ["us-east-1"],
    });

    logAudit(
      authReq.user!.sub,
      "infra_cloud_sync_triggered",
      id,
      `AWS sync: ${result.totalCreated} new, ${result.totalUpdated} updated, ${result.totalPruned} pruned, ${result.errors.length} errors`
    );

    regenerateAutoDiagrams();
    res.json(result);
  } else if (account.provider === "azure") {
    const { tenantId, clientId, clientSecret, subscriptionIds } = req.body;
    if (!tenantId || !clientId || !clientSecret) {
      res.status(400).json({ error: "tenantId, clientId, and clientSecret are required for Azure sync" });
      return;
    }

    const result = await syncAzureAccount(account, {
      tenantId,
      clientId,
      clientSecret,
      subscriptionIds: subscriptionIds || [],
    });

    logAudit(authReq.user!.sub, "infra_cloud_sync_triggered", id, `Azure sync: ${result.totalCreated} new, ${result.totalUpdated} updated`);
    regenerateAutoDiagrams();
    res.json(result);
  } else if (account.provider === "gcp") {
    const { clientEmail, privateKey, scope: gcpScope } = req.body;
    if (!clientEmail || !privateKey || !gcpScope) {
      res.status(400).json({ error: "clientEmail, privateKey, and scope are required for GCP sync" });
      return;
    }

    const result = await syncGcpAccount(account, {
      clientEmail,
      privateKey,
      scope: gcpScope,
    });

    logAudit(authReq.user!.sub, "infra_cloud_sync_triggered", id, `GCP sync: ${result.totalCreated} new, ${result.totalUpdated} updated`);
    regenerateAutoDiagrams();
    res.json(result);
  } else {
    res.status(400).json({ error: `Direct API sync not yet supported for provider: ${account.provider}` });
  }
});

// ─── Snapshots (versioning & diff) ──────────────────────────────────────────

import {
  listSnapshots,
  getSnapshot,
  takeSnapshot,
  deleteSnapshot,
  diffSnapshots,
} from "./infraSnapshots.js";

infraRouter.get("/snapshots", (_req: Request, res: Response) => {
  res.json(listSnapshots());
});

infraRouter.get("/snapshots/:id", (req: Request, res: Response) => {
  const snapshot = getSnapshot(req.params.id);
  if (!snapshot) { res.status(404).json({ error: "Snapshot not found" }); return; }
  res.json(snapshot);
});

infraRouter.post("/snapshots", (req: Request, res: Response) => {
  const authReq = req as AuthedRequest;
  const { name, description } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const snapshot = takeSnapshot(name, description || "", authReq.user!.sub);
  logAudit(authReq.user!.sub, "infra_snapshot_created", snapshot.id, `Snapshot: ${name} (${snapshot.resourceCount} resources)`);
  res.status(201).json(snapshot);
});

infraRouter.delete("/snapshots/:id", (req: Request, res: Response) => {
  const authReq = req as AuthedRequest;
  if (!deleteSnapshot(req.params.id)) { res.status(404).json({ error: "Snapshot not found" }); return; }
  logAudit(authReq.user!.sub, "infra_snapshot_deleted", req.params.id, "Snapshot deleted");
  res.json({ ok: true });
});

infraRouter.get("/snapshots/:fromId/diff/:toId", (req: Request, res: Response) => {
  const diff = diffSnapshots(req.params.fromId, req.params.toId);
  if (!diff) { res.status(404).json({ error: "Snapshot(s) not found" }); return; }
  res.json(diff);
});

// ─── Saved Diagrams (editable canvas state) ──────────────────────────────────

import { syncAwsAccount } from "./infraCloudSync.js";
import { syncAzureAccount } from "./infraCloudSyncAzure.js";
import { syncGcpAccount } from "./infraCloudSyncGcp.js";
import { listSavedDiagrams, getSavedDiagram, upsertSavedDiagram, deleteSavedDiagram, listDiagramVersions, getDiagramVersion, restoreDiagramVersion } from "./diagramStore.js";
import { regenerateAutoDiagrams, AUTO_DIAGRAM_STRATEGIES } from "./autoDiagram.js";

infraRouter.get("/diagrams", (_req: Request, res: Response) => {
  // Return metadata only (not full node/edge data) for the list view
  res.json(
    listSavedDiagrams().map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      createdBy: d.createdBy,
      isAuto: d.isAuto ?? false,
      autoKey: d.autoKey,
      autoDescription: d.autoDescription,
      nodes: d.nodes,
      edges: d.edges,
      pages: d.pages,
    }))
  );
});

infraRouter.get("/diagrams/:id", (req: Request, res: Response) => {
  const diagram = getSavedDiagram(req.params.id);
  if (!diagram) {
    res.status(404).json({ error: "Diagram not found" });
    return;
  }
  res.json(diagram);
});

infraRouter.post("/diagrams", (req: Request, res: Response) => {
  const authReq = req as AuthedRequest;
  const { id, name, nodes, edges, pages } = req.body;

  if (!name || !nodes || !edges) {
    res.status(400).json({ error: "name, nodes, and edges are required" });
    return;
  }

  const existing = id ? getSavedDiagram(id) : undefined;
  const diagram = upsertSavedDiagram(id, { name, nodes, edges, pages }, authReq.user!.sub);
  if (!existing) {
    logAudit(authReq.user!.sub, "infra_diagram_saved", diagram.id, `Saved diagram: ${name}`);
    res.status(201).json(diagram);
  } else {
    // Only overwriting an existing diagram is worth telling other viewers
    // about — a brand-new diagram has no other viewers yet by definition.
    // Broadcasts to every open diagram-collab socket for this id, including
    // the saver's own — there's no clean way to correlate this REST request
    // to one specific WebSocket connection, so the frontend just ignores
    // the notification when `by` is its own username instead.
    broadcastToDiagramViewers(diagram.id, { type: "diagram-updated", by: authReq.user!.sub });
    res.json(diagram);
  }
});

infraRouter.delete("/diagrams/:id", (req: Request, res: Response) => {
  const authReq = req as AuthedRequest;
  const removed = deleteSavedDiagram(req.params.id);
  if (!removed) {
    res.status(404).json({ error: "Diagram not found" });
    return;
  }
  logAudit(authReq.user!.sub, "infra_diagram_deleted", removed.id, `Deleted diagram: ${removed.name}`);
  res.json({ ok: true });
});

// ─── Version history (manual saves only — auto-generated diagrams never
// version, see diagramStore.ts) ──────────────────────────────────────────

infraRouter.get("/diagrams/:id/versions", (req: Request, res: Response) => {
  if (!getSavedDiagram(req.params.id)) {
    res.status(404).json({ error: "Diagram not found" });
    return;
  }
  res.json(
    listDiagramVersions(req.params.id).map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      name: v.name,
      savedAt: v.savedAt,
      savedBy: v.savedBy,
      nodeCount: v.nodes.length,
    }))
  );
});

infraRouter.get("/diagrams/:id/versions/:versionId", (req: Request, res: Response) => {
  const version = getDiagramVersion(req.params.id, req.params.versionId);
  if (!version) {
    res.status(404).json({ error: "Version not found" });
    return;
  }
  res.json(version);
});

infraRouter.post("/diagrams/:id/versions/:versionId/restore", (req: Request, res: Response) => {
  const authReq = req as AuthedRequest;
  const restored = restoreDiagramVersion(req.params.id, req.params.versionId, authReq.user!.sub);
  if (!restored) {
    res.status(404).json({ error: "Diagram or version not found" });
    return;
  }
  logAudit(authReq.user!.sub, "infra_diagram_version_restored", restored.id, `Restored "${restored.name}" to version ${req.params.versionId}`);
  res.json(restored);
});

// ─── Auto-generated diagrams ──────────────────────────────────────────────
// Regenerated automatically after every sync (see the sync routes above and
// infraCollector's agent-reported path) — this endpoint exists so an admin
// can also force a refresh on demand (e.g. right after editing tags in the
// source cloud provider, before the next scheduled sync would pick it up).

infraRouter.get("/diagram-strategies", (_req: Request, res: Response) => {
  res.json(AUTO_DIAGRAM_STRATEGIES.map((s) => ({ id: s.id, label: s.label, description: s.description })));
});

infraRouter.post("/diagrams/regenerate", (req: Request, res: Response) => {
  const authReq = req as AuthedRequest;
  const result = regenerateAutoDiagrams();
  logAudit(authReq.user!.sub, "infra_diagrams_regenerated", null, `${result.length} auto diagram(s) regenerated`);
  res.json({ regenerated: result.length, diagrams: result.map((d) => ({ id: d.id, name: d.name, autoKey: d.autoKey })) });
});
