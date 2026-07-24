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
