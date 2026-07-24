/**
 * Azure Direct Cloud Sync
 *
 * Uses Service Principal credentials (Tenant ID + App ID + Client Secret)
 * to authenticate via OAuth2 client_credentials flow, then calls Azure
 * Resource Manager REST APIs to discover infrastructure.
 *
 * Supports multi-subscription scanning (Reader role at Management Group level).
 *
 * Author: Yogesh Tiwari
 */

import {
  type InfraAccount,
  type InfraResource,
  type InfraResourceType,
  upsertInfraResources,
  pruneStaleResources,
} from "./infraDiscovery.js";
import { logAudit } from "./store.js";

export interface AzureSyncConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionIds: string[]; // if empty, discovers all accessible subscriptions
}

interface AzureToken {
  access_token: string;
  expires_in: number;
}

/**
 * Get OAuth2 Bearer token using client_credentials flow.
 */
async function getAzureToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://management.azure.com/.default",
  });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Azure OAuth2 failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as AzureToken;
  return data.access_token;
}

/**
 * Call Azure Resource Manager REST API.
 */
async function azureApiCall(path: string, token: string): Promise<unknown> {
  const url = `https://management.azure.com${path}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Azure API ${path} failed (${response.status}): ${text.slice(0, 200)}`);
  }

  return response.json();
}

/**
 * Discover all subscriptions accessible to the service principal.
 */
async function listSubscriptions(token: string): Promise<{ subscriptionId: string; displayName: string }[]> {
  const data = (await azureApiCall("/subscriptions?api-version=2022-12-01", token)) as {
    value: { subscriptionId: string; displayName: string; state: string }[];
  };
  return data.value.filter((s) => s.state === "Enabled");
}

/**
 * Run a full Azure sync.
 */
export async function syncAzureAccount(
  account: InfraAccount,
  config: AzureSyncConfig
): Promise<{ totalCreated: number; totalUpdated: number; totalPruned: number; errors: string[] }> {
  const results = { totalCreated: 0, totalUpdated: 0, totalPruned: 0, errors: [] as string[] };

  let token: string;
  try {
    token = await getAzureToken(config.tenantId, config.clientId, config.clientSecret);
  } catch (err) {
    results.errors.push(`Azure auth failed: ${(err as Error).message}`);
    return results;
  }

  // Discover subscriptions
  let subscriptions: { subscriptionId: string; displayName: string }[];
  try {
    if (config.subscriptionIds.length > 0) {
      subscriptions = config.subscriptionIds.map((id) => ({ subscriptionId: id, displayName: id }));
    } else {
      subscriptions = await listSubscriptions(token);
    }
  } catch (err) {
    results.errors.push(`List subscriptions failed: ${(err as Error).message}`);
    return results;
  }

  for (const sub of subscriptions) {
    try {
      const resources = await discoverAzureSubscription(sub.subscriptionId, token);

      const { created, updated } = upsertInfraResources(
        account.id,
        resources.map((r) => ({ ...r }))
      );

      const currentIds = resources.map((r) => r.externalId);
      const pruned = pruneStaleResources(account.id, sub.subscriptionId, currentIds);

      results.totalCreated += created;
      results.totalUpdated += updated;
      results.totalPruned += pruned;
    } catch (err) {
      results.errors.push(`${sub.displayName}: ${(err as Error).message}`);
    }
  }

  logAudit(
    "system",
    "infra_cloud_sync",
    account.id,
    `Azure sync for ${account.name}: ${results.totalCreated} new, ${results.totalUpdated} updated, ${results.errors.length} errors`
  );

  return results;
}

/**
 * Discover resources in a single Azure subscription.
 */
async function discoverAzureSubscription(
  subscriptionId: string,
  token: string
): Promise<Omit<InfraResource, "id" | "accountId" | "discoveredAt">[]> {
  const resources: Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] = [];

  // List all resources in the subscription
  try {
    const data = (await azureApiCall(
      `/subscriptions/${subscriptionId}/resources?api-version=2021-04-01`,
      token
    )) as { value: AzureResource[] };

    for (const r of data.value) {
      const mapped = mapAzureResource(r, subscriptionId);
      if (mapped) resources.push(mapped);
    }
  } catch (err) {
    console.error(`[azure-sync] Resources for ${subscriptionId}:`, (err as Error).message);
  }

  // VNets (with subnet details)
  try {
    const data = (await azureApiCall(
      `/subscriptions/${subscriptionId}/providers/Microsoft.Network/virtualNetworks?api-version=2023-11-01`,
      token
    )) as { value: AzureVNet[] };

    for (const vnet of data.value) {
      const region = vnet.location;
      resources.push({
        externalId: vnet.id,
        provider: "azure",
        region,
        type: "vpc",
        name: vnet.name,
        properties: {
          addressSpace: vnet.properties?.addressSpace?.addressPrefixes || [],
        },
        relationships: [],
        tags: vnet.tags || {},
        networkInfo: { vpcId: vnet.id },
      });

      // Subnets within the VNet
      for (const subnet of vnet.properties?.subnets || []) {
        resources.push({
          externalId: subnet.id,
          provider: "azure",
          region,
          type: "subnet",
          name: subnet.name,
          properties: {
            cidr: subnet.properties?.addressPrefix,
          },
          relationships: [{ targetResourceId: vnet.id, type: "runs-in" }],
          tags: {},
          networkInfo: { vpcId: vnet.id, subnetId: subnet.id },
        });
      }
    }
  } catch (err) {
    console.error(`[azure-sync] VNets:`, (err as Error).message);
  }

  return resources;
}

// ─── Azure type mappings ─────────────────────────────────────────────────────

interface AzureResource {
  id: string;
  name: string;
  type: string;
  location: string;
  tags?: Record<string, string>;
}

interface AzureVNet {
  id: string;
  name: string;
  location: string;
  tags?: Record<string, string>;
  properties?: {
    addressSpace?: { addressPrefixes: string[] };
    subnets?: { id: string; name: string; properties?: { addressPrefix: string } }[];
  };
}

function mapAzureResource(
  r: AzureResource,
  subscriptionId: string
): Omit<InfraResource, "id" | "accountId" | "discoveredAt"> | null {
  const typeMap: Record<string, InfraResourceType> = {
    "Microsoft.Compute/virtualMachines": "vm",
    "Microsoft.Sql/servers": "rds-instance",
    "Microsoft.DBforPostgreSQL/flexibleServers": "rds-instance",
    "Microsoft.DBforMySQL/flexibleServers": "rds-instance",
    "Microsoft.Storage/storageAccounts": "s3-bucket",
    "Microsoft.Network/loadBalancers": "load-balancer",
    "Microsoft.Network/applicationGateways": "load-balancer",
    "Microsoft.Network/networkSecurityGroups": "security-group",
    "Microsoft.Network/publicIPAddresses": "elastic-ip",
    "Microsoft.Network/networkInterfaces": "network-interface",
    "Microsoft.ContainerService/managedClusters": "kubernetes-pod",
    "Microsoft.Web/sites": "container",
    "Microsoft.Cache/Redis": "elasticache",
  };

  const mappedType = typeMap[r.type];
  if (!mappedType) return null; // skip unsupported resource types

  return {
    externalId: r.id,
    provider: "azure",
    region: r.location,
    type: mappedType,
    name: r.name,
    properties: { azureType: r.type, subscription: subscriptionId },
    relationships: [],
    tags: r.tags || {},
    networkInfo: {},
  };
}
