/**
 * GCP Direct Cloud Sync
 *
 * Uses a Service Account JSON key to authenticate, then calls the
 * Cloud Asset Inventory API (searchAllResources) to discover infrastructure.
 *
 * Supports multi-project scanning via organization or folder scope.
 *
 * Author: Yogesh Tiwari
 */

import crypto from "node:crypto";
import {
  type InfraAccount,
  type InfraResource,
  type InfraResourceType,
  upsertInfraResources,
  pruneStaleResources,
} from "./infraDiscovery.js";
import { logAudit } from "./store.js";

export interface GcpSyncConfig {
  // Service Account JSON key (parsed)
  clientEmail: string;
  privateKey: string;
  projectId?: string;
  // Scope: "projects/{id}", "folders/{id}", or "organizations/{id}"
  scope: string;
}

/**
 * Create a signed JWT and exchange it for a Google access token.
 */
async function getGcpToken(clientEmail: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/cloud-platform.read-only",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  // Sign with RSA-SHA256 using the service account's private key
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signatureInput);
  const signature = sign.sign(privateKey, "base64url");

  const jwt = `${signatureInput}.${signature}`;

  // Exchange JWT for access token
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GCP OAuth2 failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Call GCP REST API.
 */
async function gcpApiCall(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GCP API failed (${response.status}): ${text.slice(0, 200)}`);
  }

  return response.json();
}

/**
 * Run a full GCP sync using Cloud Asset Inventory.
 */
export async function syncGcpAccount(
  account: InfraAccount,
  config: GcpSyncConfig
): Promise<{ totalCreated: number; totalUpdated: number; totalPruned: number; errors: string[] }> {
  const results = { totalCreated: 0, totalUpdated: 0, totalPruned: 0, errors: [] as string[] };

  let token: string;
  try {
    token = await getGcpToken(config.clientEmail, config.privateKey);
  } catch (err) {
    results.errors.push(`GCP auth failed: ${(err as Error).message}`);
    return results;
  }

  try {
    const resources = await discoverGcpResources(config.scope, token);

    const { created, updated } = upsertInfraResources(
      account.id,
      resources
    );

    const currentIds = resources.map((r) => r.externalId);
    const pruned = pruneStaleResources(account.id, config.scope, currentIds);

    results.totalCreated = created;
    results.totalUpdated = updated;
    results.totalPruned = pruned;
  } catch (err) {
    results.errors.push(`Discovery failed: ${(err as Error).message}`);
  }

  logAudit(
    "system",
    "infra_cloud_sync",
    account.id,
    `GCP sync for ${account.name}: ${results.totalCreated} new, ${results.totalUpdated} updated, ${results.errors.length} errors`
  );

  return results;
}

/**
 * Discover resources using Cloud Asset Inventory searchAllResources.
 */
async function discoverGcpResources(
  scope: string,
  token: string
): Promise<Omit<InfraResource, "id" | "accountId" | "discoveredAt">[]> {
  const resources: Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] = [];

  // Asset types we care about
  const assetTypes = [
    "compute.googleapis.com/Instance",
    "compute.googleapis.com/Network",
    "compute.googleapis.com/Subnetwork",
    "compute.googleapis.com/Firewall",
    "compute.googleapis.com/ForwardingRule",
    "sqladmin.googleapis.com/Instance",
    "container.googleapis.com/Cluster",
    "storage.googleapis.com/Bucket",
    "cloudfunctions.googleapis.com/Function",
    "run.googleapis.com/Service",
  ];

  const assetTypesParam = assetTypes.map((t) => `assetTypes=${encodeURIComponent(t)}`).join("&");
  let pageToken = "";

  do {
    const url = `https://cloudasset.googleapis.com/v1/${scope}:searchAllResources?${assetTypesParam}&pageSize=500${pageToken ? `&pageToken=${pageToken}` : ""}`;

    const data = (await gcpApiCall(url, token)) as {
      results?: GcpAssetResult[];
      nextPageToken?: string;
    };

    for (const result of data.results || []) {
      const mapped = mapGcpResource(result);
      if (mapped) resources.push(mapped);
    }

    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return resources;
}

// ─── GCP type mappings ───────────────────────────────────────────────────────

interface GcpAssetResult {
  name: string;         // full resource name
  assetType: string;
  project: string;
  displayName: string;
  location: string;
  networkTags?: string[];
  labels?: Record<string, string>;
  additionalAttributes?: Record<string, unknown>;
}

function mapGcpResource(
  r: GcpAssetResult
): Omit<InfraResource, "id" | "accountId" | "discoveredAt"> | null {
  const typeMap: Record<string, InfraResourceType> = {
    "compute.googleapis.com/Instance": "vm",
    "compute.googleapis.com/Network": "vpc",
    "compute.googleapis.com/Subnetwork": "subnet",
    "compute.googleapis.com/Firewall": "security-group",
    "compute.googleapis.com/ForwardingRule": "load-balancer",
    "sqladmin.googleapis.com/Instance": "rds-instance",
    "container.googleapis.com/Cluster": "kubernetes-pod",
    "storage.googleapis.com/Bucket": "s3-bucket",
    "cloudfunctions.googleapis.com/Function": "lambda",
    "run.googleapis.com/Service": "container",
  };

  const mappedType = typeMap[r.assetType];
  if (!mappedType) return null;

  // Extract region from location (e.g., "us-central1-a" → "us-central1")
  const region = r.location?.replace(/-[a-z]$/, "") || "global";

  return {
    externalId: r.name,
    provider: "gcp",
    region,
    type: mappedType,
    name: r.displayName || r.name.split("/").pop() || r.name,
    properties: {
      project: r.project,
      assetType: r.assetType,
      location: r.location,
    },
    relationships: [],
    tags: r.labels || {},
    networkInfo: {},
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function base64url(str: string): string {
  return Buffer.from(str).toString("base64url");
}
