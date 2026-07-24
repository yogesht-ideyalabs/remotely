/**
 * Infrastructure Discovery & Diagram Generation
 *
 * This module handles:
 * 1. Storing infrastructure data reported by agents (cloud resources, VMs, networking)
 * 2. Accepting direct cloud-account configurations for API-based discovery
 * 3. Building a graph model of all discovered resources
 * 4. Generating architecture and network diagrams (Mermaid/D2 format for browser rendering)
 */

import crypto from "node:crypto";
import { loadTable, saveRow, deleteRow } from "./db.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CloudProvider = "aws" | "azure" | "gcp" | "vmware" | "proxmox" | "on-prem" | "other";

export interface InfraAccount {
  id: string;
  name: string;
  provider: CloudProvider;
  // For cloud providers: account/subscription/project ID
  accountId: string;
  // Regions to scan (empty = all available)
  regions: string[];
  // How this account is accessed:
  // - "agent": an agent on-site discovers resources and reports them
  // - "api": control plane calls cloud APIs directly (needs credentials)
  accessMode: "agent" | "api";
  // If accessMode=agent, which agent(s) report for this account
  agentIds: string[];
  // If accessMode=api, credential reference (not the credential itself)
  credentialRef?: string;
  enabled: boolean;
  lastSyncAt: number | null;
  createdAt: number;
  createdBy: string;
}

export interface InfraResource {
  id: string;                    // unique within this system
  externalId: string;            // provider-native ID (e.g., i-1234567, vm-100)
  accountId: string;             // links to InfraAccount.id
  provider: CloudProvider;
  region: string;
  type: InfraResourceType;
  name: string;
  // Provider-specific properties
  properties: Record<string, unknown>;
  // Relationships (edges in the graph)
  relationships: InfraRelationship[];
  // Tags/labels from the provider
  tags: Record<string, string>;
  // Network info
  networkInfo?: {
    vpcId?: string;
    subnetId?: string;
    privateIps?: string[];
    publicIps?: string[];
    securityGroups?: string[];
  };
  discoveredAt: number;
  reportedByAgent?: string;
}

export type InfraResourceType =
  // Compute
  | "vm" | "container" | "lambda" | "ecs-task" | "kubernetes-pod"
  // Networking
  | "vpc" | "subnet" | "security-group" | "load-balancer" | "nat-gateway"
  | "internet-gateway" | "route-table" | "vpn-gateway" | "transit-gateway"
  | "network-interface" | "elastic-ip"
  // Storage
  | "s3-bucket" | "ebs-volume" | "efs" | "storage-account"
  // Database
  | "rds-instance" | "rds-cluster" | "dynamodb-table" | "elasticache"
  // Other
  | "dns-zone" | "cdn" | "queue" | "topic" | "api-gateway"
  // VMware / Proxmox
  | "esxi-host" | "datastore" | "vswitch" | "proxmox-node" | "proxmox-vm" | "proxmox-container"
  | "other";

export interface InfraRelationship {
  targetResourceId: string;      // the externalId of the related resource
  type: RelationshipType;
}

export type RelationshipType =
  | "runs-in"         // VM runs in a subnet/VPC
  | "attached-to"     // EBS attached to EC2, ENI attached to instance
  | "routes-to"       // Route table routes to IGW/NAT
  | "member-of"       // Instance is member of security group
  | "targets"         // LB targets an instance
  | "peers-with"      // VPC peering
  | "connects-to"     // Generic connection (e.g., Lambda → DynamoDB)
  | "contains"        // VPC contains subnet, subnet contains instance
  | "depends-on";     // Generic dependency

// ─── Storage ─────────────────────────────────────────────────────────────────

export const infraAccounts: InfraAccount[] = loadTable<InfraAccount>("infraAccounts");
export const infraResources: InfraResource[] = loadTable<InfraResource>("infraResources");

// ─── Account CRUD ────────────────────────────────────────────────────────────

export function listInfraAccounts(): InfraAccount[] {
  return infraAccounts;
}

export function getInfraAccount(id: string): InfraAccount | undefined {
  return infraAccounts.find((a) => a.id === id);
}

export function createInfraAccount(
  data: Omit<InfraAccount, "id" | "createdAt" | "lastSyncAt">
): InfraAccount {
  const account: InfraAccount = {
    ...data,
    id: crypto.randomUUID(),
    lastSyncAt: null,
    createdAt: Date.now(),
  };
  infraAccounts.push(account);
  saveRow("infraAccounts", account.id, account);
  return account;
}

export function updateInfraAccount(
  id: string,
  changes: Partial<Omit<InfraAccount, "id" | "createdAt">>
): InfraAccount | undefined {
  const account = getInfraAccount(id);
  if (!account) return undefined;
  Object.assign(account, changes);
  saveRow("infraAccounts", account.id, account);
  return account;
}

export function deleteInfraAccount(id: string): boolean {
  const idx = infraAccounts.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  infraAccounts.splice(idx, 1);
  deleteRow("infraAccounts", id);
  // Also remove all resources belonging to this account
  const toRemove = infraResources.filter((r) => r.accountId === id);
  for (const r of toRemove) {
    const rIdx = infraResources.indexOf(r);
    if (rIdx !== -1) infraResources.splice(rIdx, 1);
    deleteRow("infraResources", r.id);
  }
  return true;
}

// ─── Resource management ─────────────────────────────────────────────────────

export function listInfraResources(filters?: {
  accountId?: string;
  provider?: CloudProvider;
  region?: string;
  type?: InfraResourceType;
}): InfraResource[] {
  let results = infraResources;
  if (filters?.accountId) results = results.filter((r) => r.accountId === filters.accountId);
  if (filters?.provider) results = results.filter((r) => r.provider === filters.provider);
  if (filters?.region) results = results.filter((r) => r.region === filters.region);
  if (filters?.type) results = results.filter((r) => r.type === filters.type);
  return results;
}

export function getInfraResource(id: string): InfraResource | undefined {
  return infraResources.find((r) => r.id === id);
}

/**
 * Bulk upsert resources reported by an agent or API sync.
 * Resources are matched by (accountId + externalId) — if a match exists, it's updated;
 * otherwise a new resource is created.
 */
export function upsertInfraResources(
  accountId: string,
  resources: Omit<InfraResource, "id" | "accountId" | "discoveredAt">[]
): { created: number; updated: number } {
  let created = 0;
  let updated = 0;

  for (const incoming of resources) {
    const existing = infraResources.find(
      (r) => r.accountId === accountId && r.externalId === incoming.externalId
    );

    if (existing) {
      Object.assign(existing, { ...incoming, accountId, discoveredAt: Date.now() });
      saveRow("infraResources", existing.id, existing);
      updated++;
    } else {
      const resource: InfraResource = {
        ...incoming,
        id: crypto.randomUUID(),
        accountId,
        discoveredAt: Date.now(),
      };
      infraResources.push(resource);
      saveRow("infraResources", resource.id, resource);
      created++;
    }
  }

  // Update account's lastSyncAt
  const account = getInfraAccount(accountId);
  if (account) {
    account.lastSyncAt = Date.now();
    saveRow("infraAccounts", account.id, account);
  }

  return { created, updated };
}

/**
 * Remove stale resources that weren't seen in the latest sync.
 * Called after a full sync to clean up resources that no longer exist.
 */
export function pruneStaleResources(accountId: string, region: string, currentExternalIds: string[]): number {
  const idsToKeep = new Set(currentExternalIds);
  const stale = infraResources.filter(
    (r) => r.accountId === accountId && r.region === region && !idsToKeep.has(r.externalId)
  );
  for (const r of stale) {
    const idx = infraResources.indexOf(r);
    if (idx !== -1) infraResources.splice(idx, 1);
    deleteRow("infraResources", r.id);
  }
  return stale.length;
}

// ─── Diagram Generation ──────────────────────────────────────────────────────

export type DiagramFormat = "mermaid" | "d2" | "json-graph";

export interface DiagramOptions {
  format: DiagramFormat;
  scope: "all" | "account" | "region" | "vpc";
  scopeId?: string;            // account ID, region name, or VPC ID depending on scope
  diagramType: "architecture" | "network" | "both";
  includeTypes?: InfraResourceType[];
  excludeTypes?: InfraResourceType[];
  groupBy: "account" | "region" | "vpc" | "type";
}

export interface GeneratedDiagram {
  format: DiagramFormat;
  diagramType: "architecture" | "network";
  content: string;             // The diagram source code (Mermaid/D2/JSON)
  resourceCount: number;
  generatedAt: number;
}

/**
 * Generate diagram(s) from discovered infrastructure.
 */
export function generateDiagram(options: DiagramOptions): GeneratedDiagram[] {
  const results: GeneratedDiagram[] = [];

  // Filter resources by scope
  let resources = [...infraResources];
  if (options.scope === "account" && options.scopeId) {
    resources = resources.filter((r) => r.accountId === options.scopeId);
  } else if (options.scope === "region" && options.scopeId) {
    resources = resources.filter((r) => r.region === options.scopeId);
  } else if (options.scope === "vpc" && options.scopeId) {
    resources = resources.filter((r) => r.networkInfo?.vpcId === options.scopeId);
  }

  // Apply type filters
  if (options.includeTypes?.length) {
    resources = resources.filter((r) => options.includeTypes!.includes(r.type));
  }
  if (options.excludeTypes?.length) {
    resources = resources.filter((r) => !options.excludeTypes!.includes(r.type));
  }

  if (options.diagramType === "architecture" || options.diagramType === "both") {
    const content = options.format === "mermaid"
      ? generateMermaidArchitecture(resources, options)
      : options.format === "d2"
        ? generateD2Architecture(resources, options)
        : generateJsonGraph(resources);

    results.push({
      format: options.format,
      diagramType: "architecture",
      content,
      resourceCount: resources.length,
      generatedAt: Date.now(),
    });
  }

  if (options.diagramType === "network" || options.diagramType === "both") {
    const networkResources = resources.filter((r) =>
      ["vpc", "subnet", "security-group", "load-balancer", "nat-gateway",
       "internet-gateway", "route-table", "vpn-gateway", "transit-gateway",
       "network-interface", "elastic-ip", "vm", "container"].includes(r.type)
    );

    const content = options.format === "mermaid"
      ? generateMermaidNetwork(networkResources, options)
      : options.format === "d2"
        ? generateD2Network(networkResources, options)
        : generateJsonGraph(networkResources);

    results.push({
      format: options.format,
      diagramType: "network",
      content,
      resourceCount: networkResources.length,
      generatedAt: Date.now(),
    });
  }

  return results;
}

// ─── Mermaid Generators ──────────────────────────────────────────────────────

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function generateMermaidArchitecture(resources: InfraResource[], options: DiagramOptions): string {
  const lines: string[] = ["graph TB"];

  // Group resources
  const groups = groupResources(resources, options.groupBy);

  for (const [groupName, groupResources] of Object.entries(groups)) {
    const groupId = sanitizeId(groupName);
    lines.push(`  subgraph ${groupId}["${groupName}"]`);

    // Sub-group by type within each group
    const byType = new Map<string, InfraResource[]>();
    for (const r of groupResources) {
      const arr = byType.get(r.type) || [];
      arr.push(r);
      byType.set(r.type, arr);
    }

    for (const [type, typed] of byType) {
      for (const r of typed) {
        const nodeId = sanitizeId(r.externalId);
        const icon = getMermaidIcon(r.type);
        const label = r.name || r.externalId;
        lines.push(`    ${nodeId}${icon}["${label}"]`);
      }
    }

    lines.push("  end");
  }

  // Add relationships as edges
  const allExternalIds = new Set(resources.map((r) => r.externalId));
  for (const resource of resources) {
    for (const rel of resource.relationships) {
      if (allExternalIds.has(rel.targetResourceId)) {
        const fromId = sanitizeId(resource.externalId);
        const toId = sanitizeId(rel.targetResourceId);
        const label = rel.type.replace(/-/g, " ");
        lines.push(`  ${fromId} -->|${label}| ${toId}`);
      }
    }
  }

  return lines.join("\n");
}

function generateMermaidNetwork(resources: InfraResource[], options: DiagramOptions): string {
  const lines: string[] = ["graph TB"];

  // Group by VPC
  const vpcs = resources.filter((r) => r.type === "vpc");
  const noVpc = resources.filter((r) => !r.networkInfo?.vpcId && r.type !== "vpc");

  for (const vpc of vpcs) {
    const vpcId = sanitizeId(vpc.externalId);
    const vpcLabel = vpc.name || vpc.externalId;
    const cidr = (vpc.properties as { cidr?: string }).cidr || "";
    lines.push(`  subgraph ${vpcId}["🌐 ${vpcLabel} (${cidr})"]`);

    // Subnets within this VPC
    const subnets = resources.filter(
      (r) => r.type === "subnet" && r.networkInfo?.vpcId === vpc.externalId
    );

    for (const subnet of subnets) {
      const subnetId = sanitizeId(subnet.externalId);
      const subnetLabel = subnet.name || subnet.externalId;
      const subnetCidr = (subnet.properties as { cidr?: string }).cidr || "";
      const isPublic = (subnet.properties as { public?: boolean }).public;
      const icon = isPublic ? "🌍" : "🔒";
      lines.push(`    subgraph ${subnetId}["${icon} ${subnetLabel} (${subnetCidr})"]`);

      // Resources in this subnet
      const inSubnet = resources.filter(
        (r) => r.networkInfo?.subnetId === subnet.externalId && r.type !== "subnet"
      );
      for (const r of inSubnet) {
        const nodeId = sanitizeId(r.externalId);
        const nodeIcon = getMermaidIcon(r.type);
        lines.push(`      ${nodeId}${nodeIcon}["${r.name || r.externalId}"]`);
      }

      lines.push("    end");
    }

    // IGWs, NATs attached to this VPC
    const igws = resources.filter(
      (r) => r.type === "internet-gateway" && r.networkInfo?.vpcId === vpc.externalId
    );
    for (const igw of igws) {
      const igwId = sanitizeId(igw.externalId);
      lines.push(`    ${igwId}["🚪 ${igw.name || "IGW"}"]`);
    }

    const nats = resources.filter(
      (r) => r.type === "nat-gateway" && r.networkInfo?.vpcId === vpc.externalId
    );
    for (const nat of nats) {
      const natId = sanitizeId(nat.externalId);
      lines.push(`    ${natId}["🔄 ${nat.name || "NAT GW"}"]`);
    }

    lines.push("  end");
  }

  // Resources not in any VPC
  if (noVpc.length > 0) {
    lines.push(`  subgraph external["External / Global"]`);
    for (const r of noVpc) {
      const nodeId = sanitizeId(r.externalId);
      const icon = getMermaidIcon(r.type);
      lines.push(`    ${nodeId}${icon}["${r.name || r.externalId}"]`);
    }
    lines.push("  end");
  }

  // Edges
  const allExternalIds = new Set(resources.map((r) => r.externalId));
  for (const resource of resources) {
    for (const rel of resource.relationships) {
      if (allExternalIds.has(rel.targetResourceId)) {
        const fromId = sanitizeId(resource.externalId);
        const toId = sanitizeId(rel.targetResourceId);
        lines.push(`  ${fromId} --> ${toId}`);
      }
    }
  }

  return lines.join("\n");
}

// ─── D2 Generator ────────────────────────────────────────────────────────────

function generateD2Architecture(resources: InfraResource[], options: DiagramOptions): string {
  const lines: string[] = [];

  const groups = groupResources(resources, options.groupBy);

  for (const [groupName, groupResources] of Object.entries(groups)) {
    const groupId = sanitizeId(groupName);
    lines.push(`${groupId}: "${groupName}" {`);

    for (const r of groupResources) {
      const nodeId = sanitizeId(r.externalId);
      const shape = getD2Shape(r.type);
      lines.push(`  ${nodeId}: "${r.name || r.externalId}" { shape: ${shape} }`);
    }

    lines.push("}");
    lines.push("");
  }

  // Relationships
  const allExternalIds = new Set(resources.map((r) => r.externalId));
  for (const resource of resources) {
    for (const rel of resource.relationships) {
      if (allExternalIds.has(rel.targetResourceId)) {
        const fromId = sanitizeId(resource.externalId);
        const toId = sanitizeId(rel.targetResourceId);
        lines.push(`${fromId} -> ${toId}: "${rel.type}"`);
      }
    }
  }

  return lines.join("\n");
}

function generateD2Network(resources: InfraResource[], options: DiagramOptions): string {
  // Similar to D2 architecture but focused on networking hierarchy
  const lines: string[] = [];
  const vpcs = resources.filter((r) => r.type === "vpc");

  for (const vpc of vpcs) {
    const vpcId = sanitizeId(vpc.externalId);
    const cidr = (vpc.properties as { cidr?: string }).cidr || "";
    lines.push(`${vpcId}: "${vpc.name || vpc.externalId} (${cidr})" {`);

    const subnets = resources.filter(
      (r) => r.type === "subnet" && r.networkInfo?.vpcId === vpc.externalId
    );

    for (const subnet of subnets) {
      const subnetId = sanitizeId(subnet.externalId);
      const subnetCidr = (subnet.properties as { cidr?: string }).cidr || "";
      lines.push(`  ${subnetId}: "${subnet.name || subnet.externalId} (${subnetCidr})" {`);

      const inSubnet = resources.filter(
        (r) => r.networkInfo?.subnetId === subnet.externalId && r.type !== "subnet"
      );
      for (const r of inSubnet) {
        const nodeId = sanitizeId(r.externalId);
        lines.push(`    ${nodeId}: "${r.name || r.externalId}" { shape: ${getD2Shape(r.type)} }`);
      }

      lines.push("  }");
    }

    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

// ─── JSON Graph (for custom frontend rendering) ──────────────────────────────

function generateJsonGraph(resources: InfraResource[]): string {
  const nodes = resources.map((r) => ({
    id: r.externalId,
    label: r.name || r.externalId,
    type: r.type,
    provider: r.provider,
    region: r.region,
    accountId: r.accountId,
    networkInfo: r.networkInfo,
    tags: r.tags,
    properties: r.properties,
  }));

  const edges: { source: string; target: string; type: string }[] = [];
  const allExternalIds = new Set(resources.map((r) => r.externalId));

  for (const resource of resources) {
    for (const rel of resource.relationships) {
      if (allExternalIds.has(rel.targetResourceId)) {
        edges.push({
          source: resource.externalId,
          target: rel.targetResourceId,
          type: rel.type,
        });
      }
    }
  }

  return JSON.stringify({ nodes, edges }, null, 2);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupResources(
  resources: InfraResource[],
  groupBy: string
): Record<string, InfraResource[]> {
  const groups: Record<string, InfraResource[]> = {};

  for (const r of resources) {
    let key: string;
    switch (groupBy) {
      case "account": {
        const account = getInfraAccount(r.accountId);
        key = account?.name || r.accountId;
        break;
      }
      case "region":
        key = r.region || "global";
        break;
      case "vpc":
        key = r.networkInfo?.vpcId || "no-vpc";
        break;
      case "type":
        key = r.type;
        break;
      default:
        key = "default";
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }

  return groups;
}

function getMermaidIcon(type: InfraResourceType): string {
  const icons: Record<string, string> = {
    "vm": "🖥️",
    "container": "📦",
    "lambda": "⚡",
    "load-balancer": "⚖️",
    "rds-instance": "🗄️",
    "rds-cluster": "🗄️",
    "s3-bucket": "🪣",
    "vpc": "🌐",
    "subnet": "📡",
    "nat-gateway": "🔄",
    "internet-gateway": "🚪",
    "security-group": "🛡️",
    "elasticache": "⚡",
    "dynamodb-table": "📋",
    "queue": "📬",
    "cdn": "🌍",
  };
  return icons[type] ? `["${icons[type]}"]` : "";
}

function getD2Shape(type: InfraResourceType): string {
  const shapes: Record<string, string> = {
    "vm": "rectangle",
    "container": "hexagon",
    "lambda": "diamond",
    "load-balancer": "oval",
    "rds-instance": "cylinder",
    "rds-cluster": "cylinder",
    "s3-bucket": "cylinder",
    "vpc": "rectangle",
    "subnet": "rectangle",
    "queue": "queue",
  };
  return shapes[type] || "rectangle";
}

// ─── Summary / Stats ─────────────────────────────────────────────────────────

export interface InfraSummary {
  totalResources: number;
  byProvider: Record<string, number>;
  byType: Record<string, number>;
  byRegion: Record<string, number>;
  byAccount: { id: string; name: string; count: number }[];
  lastSyncAt: number | null;
}

export function getInfraSummary(): InfraSummary {
  const byProvider: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byRegion: Record<string, number> = {};
  const accountCounts: Record<string, number> = {};

  for (const r of infraResources) {
    byProvider[r.provider] = (byProvider[r.provider] || 0) + 1;
    byType[r.type] = (byType[r.type] || 0) + 1;
    byRegion[r.region] = (byRegion[r.region] || 0) + 1;
    accountCounts[r.accountId] = (accountCounts[r.accountId] || 0) + 1;
  }

  const byAccount = Object.entries(accountCounts).map(([id, count]) => {
    const account = getInfraAccount(id);
    return { id, name: account?.name || id, count };
  });

  const lastSyncAt = infraAccounts.reduce<number | null>((latest, a) => {
    if (!a.lastSyncAt) return latest;
    return latest ? Math.max(latest, a.lastSyncAt) : a.lastSyncAt;
  }, null);

  return {
    totalResources: infraResources.length,
    byProvider,
    byType,
    byRegion,
    byAccount,
    lastSyncAt,
  };
}
