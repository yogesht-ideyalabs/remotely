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
import { requireAuth, type AuthedRequest } from "./auth.js";
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

export const infraRouter = Router();

// All infra routes require authentication
infraRouter.use(requireAuth);

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
    res.json(result);
  } else {
    res.status(400).json({ error: `Direct API sync not yet supported for provider: ${account.provider}` });
  }
});

// ─── Saved Diagrams (editable canvas state) ──────────────────────────────────

import crypto from "node:crypto";
import { syncAwsAccount } from "./infraCloudSync.js";
import { syncAzureAccount } from "./infraCloudSyncAzure.js";
import { syncGcpAccount } from "./infraCloudSyncGcp.js";

interface SavedDiagram {
  id: string;
  name: string;
  nodes: unknown[];
  edges: unknown[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

const savedDiagrams: SavedDiagram[] = loadTable<SavedDiagram>("infraDiagrams");

infraRouter.get("/diagrams", (_req: Request, res: Response) => {
  // Return metadata only (not full node/edge data) for the list view
  res.json(
    savedDiagrams.map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      createdBy: d.createdBy,
      nodes: d.nodes,
      edges: d.edges,
    }))
  );
});

infraRouter.get("/diagrams/:id", (req: Request, res: Response) => {
  const diagram = savedDiagrams.find((d) => d.id === req.params.id);
  if (!diagram) {
    res.status(404).json({ error: "Diagram not found" });
    return;
  }
  res.json(diagram);
});

infraRouter.post("/diagrams", (req: Request, res: Response) => {
  const authReq = req as AuthedRequest;
  const { id, name, nodes, edges } = req.body;

  if (!name || !nodes || !edges) {
    res.status(400).json({ error: "name, nodes, and edges are required" });
    return;
  }

  // Update existing or create new
  if (id) {
    const existing = savedDiagrams.find((d) => d.id === id);
    if (existing) {
      existing.name = name;
      existing.nodes = nodes;
      existing.edges = edges;
      existing.updatedAt = Date.now();
      saveRow("infraDiagrams", existing.id, existing);
      res.json(existing);
      return;
    }
  }

  // Create new
  const diagram: SavedDiagram = {
    id: crypto.randomUUID(),
    name,
    nodes,
    edges,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: authReq.user!.sub,
  };
  savedDiagrams.push(diagram);
  saveRow("infraDiagrams", diagram.id, diagram);

  logAudit(authReq.user!.sub, "infra_diagram_saved", diagram.id, `Saved diagram: ${name}`);
  res.status(201).json(diagram);
});

infraRouter.delete("/diagrams/:id", (req: Request, res: Response) => {
  const authReq = req as AuthedRequest;
  const idx = savedDiagrams.findIndex((d) => d.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: "Diagram not found" });
    return;
  }
  const [removed] = savedDiagrams.splice(idx, 1);
  deleteRow("infraDiagrams", removed.id);
  logAudit(authReq.user!.sub, "infra_diagram_deleted", removed.id, `Deleted diagram: ${removed.name}`);
  res.json({ ok: true });
});
