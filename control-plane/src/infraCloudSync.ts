/**
 * Direct Cloud API Sync — Control plane calls cloud provider APIs directly.
 *
 * Mode 2 access: No agent needed. The control plane uses stored credentials
 * (IAM Role ARN for AWS, Service Principal for Azure, SA key for GCP) to
 * directly query cloud APIs and discover resources.
 *
 * Currently supported:
 * - AWS (via STS AssumeRole → ec2/rds/elbv2/lambda describe calls)
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

// ─── AWS Direct Sync ─────────────────────────────────────────────────────────

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
}

interface AwsSyncConfig {
  roleArn: string;
  externalId?: string;
  regions: string[];
}

/**
 * Assume an IAM role using STS and get temporary credentials.
 * Uses the raw HTTPS API (no SDK dependency) — keeps the control plane lightweight.
 */
async function assumeRole(roleArn: string, externalId?: string): Promise<AwsCredentials> {
  const sessionName = `remotely-infra-${Date.now()}`;
  const params = new URLSearchParams({
    Action: "AssumeRole",
    Version: "2011-06-15",
    RoleArn: roleArn,
    RoleSessionName: sessionName,
    DurationSeconds: "3600",
  });
  if (externalId) params.set("ExternalId", externalId);

  // This requires the control plane itself to have AWS credentials
  // (either via env vars, instance profile, or ECS task role)
  const { SignatureV4 } = await import("./awsSigV4.js");
  const signer = new SignatureV4("sts", "us-east-1");

  const url = "https://sts.amazonaws.com/";
  const body = params.toString();

  const signedHeaders = await signer.sign("POST", url, {
    "Content-Type": "application/x-www-form-urlencoded",
  }, body);

  const response = await fetch(url, {
    method: "POST",
    headers: signedHeaders,
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`STS AssumeRole failed (${response.status}): ${text}`);
  }

  const xml = await response.text();
  // Parse the XML response (minimal XML parsing for STS)
  const accessKeyId = extractXmlValue(xml, "AccessKeyId");
  const secretAccessKey = extractXmlValue(xml, "SecretAccessKey");
  const sessionToken = extractXmlValue(xml, "SessionToken");
  const expiration = extractXmlValue(xml, "Expiration");

  if (!accessKeyId || !secretAccessKey || !sessionToken) {
    throw new Error("STS AssumeRole response missing credential fields");
  }

  return { accessKeyId, secretAccessKey, sessionToken, expiration: expiration || "" };
}

/**
 * Make an AWS API call with temporary credentials.
 */
async function awsApiCall(
  service: string,
  region: string,
  action: string,
  credentials: AwsCredentials,
  extraParams?: Record<string, string>
): Promise<string> {
  const { SignatureV4 } = await import("./awsSigV4.js");
  const signer = new SignatureV4(service, region, credentials);

  const params = new URLSearchParams({
    Action: action,
    Version: getApiVersion(service),
    ...(extraParams || {}),
  });

  const host = `${service}.${region}.amazonaws.com`;
  const url = `https://${host}/`;
  const body = params.toString();

  const signedHeaders = await signer.sign("POST", url, {
    "Content-Type": "application/x-www-form-urlencoded",
    Host: host,
  }, body);

  const response = await fetch(url, {
    method: "POST",
    headers: signedHeaders,
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AWS ${service}:${action} failed (${response.status}): ${text.slice(0, 200)}`);
  }

  return response.text();
}

function getApiVersion(service: string): string {
  const versions: Record<string, string> = {
    ec2: "2016-11-15",
    rds: "2014-10-31",
    elasticloadbalancing: "2015-12-01",
    lambda: "2015-03-31",
  };
  return versions[service] || "2016-11-15";
}

/**
 * Run a full AWS sync for one account across specified regions.
 */
export async function syncAwsAccount(
  account: InfraAccount,
  config: AwsSyncConfig
): Promise<{ totalCreated: number; totalUpdated: number; totalPruned: number; errors: string[] }> {
  const results = { totalCreated: 0, totalUpdated: 0, totalPruned: 0, errors: [] as string[] };

  let credentials: AwsCredentials;
  try {
    credentials = await assumeRole(config.roleArn, config.externalId);
  } catch (err) {
    results.errors.push(`AssumeRole failed: ${(err as Error).message}`);
    return results;
  }

  for (const region of config.regions) {
    try {
      const resources = await discoverAwsRegion(region, credentials);

      const { created, updated } = upsertInfraResources(
        account.id,
        resources.map((r) => ({ ...r, reportedByAgent: undefined }))
      );

      const currentIds = resources.map((r) => r.externalId);
      const pruned = pruneStaleResources(account.id, region, currentIds);

      results.totalCreated += created;
      results.totalUpdated += updated;
      results.totalPruned += pruned;
    } catch (err) {
      results.errors.push(`${region}: ${(err as Error).message}`);
    }
  }

  logAudit(
    "system",
    "infra_cloud_sync",
    account.id,
    `AWS sync for ${account.name}: ${results.totalCreated} created, ${results.totalUpdated} updated, ${results.totalPruned} pruned, ${results.errors.length} errors`
  );

  return results;
}

/**
 * Discover all resources in a single AWS region.
 */
async function discoverAwsRegion(
  region: string,
  credentials: AwsCredentials
): Promise<Omit<InfraResource, "id" | "accountId" | "discoveredAt">[]> {
  const resources: Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] = [];

  // EC2 Instances
  try {
    const xml = await awsApiCall("ec2", region, "DescribeInstances", credentials);
    resources.push(...parseEc2Instances(xml, region));
  } catch (err) {
    console.error(`[infra-sync] EC2 ${region}:`, (err as Error).message);
  }

  // VPCs
  try {
    const xml = await awsApiCall("ec2", region, "DescribeVpcs", credentials);
    resources.push(...parseVpcs(xml, region));
  } catch (err) {
    console.error(`[infra-sync] VPC ${region}:`, (err as Error).message);
  }

  // Subnets
  try {
    const xml = await awsApiCall("ec2", region, "DescribeSubnets", credentials);
    resources.push(...parseSubnets(xml, region));
  } catch (err) {
    console.error(`[infra-sync] Subnets ${region}:`, (err as Error).message);
  }

  // Security Groups
  try {
    const xml = await awsApiCall("ec2", region, "DescribeSecurityGroups", credentials);
    resources.push(...parseSecurityGroups(xml, region));
  } catch (err) {
    console.error(`[infra-sync] SGs ${region}:`, (err as Error).message);
  }

  // Load Balancers (ELBv2)
  try {
    const xml = await awsApiCall("elasticloadbalancing", region, "DescribeLoadBalancers", credentials);
    resources.push(...parseLoadBalancers(xml, region));
  } catch (err) {
    console.error(`[infra-sync] ELB ${region}:`, (err as Error).message);
  }

  return resources;
}

// ─── XML Parsers (minimal, no dependency) ────────────────────────────────────

function extractXmlValue(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, "s");
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}

function extractAllXmlBlocks(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, "gs");
  const blocks: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function parseEc2Instances(xml: string, region: string): Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] {
  const results: Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] = [];
  const items = extractAllXmlBlocks(xml, "item");

  for (const item of items) {
    const instanceId = extractXmlValue(item, "instanceId");
    if (!instanceId || !instanceId.startsWith("i-")) continue;

    const vpcId = extractXmlValue(item, "vpcId");
    const subnetId = extractXmlValue(item, "subnetId");
    const privateIp = extractXmlValue(item, "privateIpAddress");
    const publicIp = extractXmlValue(item, "ipAddress");
    const instanceType = extractXmlValue(item, "instanceType");
    const state = extractXmlValue(item, "name"); // inside <instanceState><name>

    // Extract Name tag
    const tagBlocks = extractAllXmlBlocks(item, "item");
    let name = instanceId;
    for (const tb of tagBlocks) {
      if (extractXmlValue(tb, "key") === "Name") {
        name = extractXmlValue(tb, "value") || instanceId;
        break;
      }
    }

    results.push({
      externalId: instanceId,
      provider: "aws",
      region,
      type: "vm" as InfraResourceType,
      name,
      properties: { instanceType, state },
      relationships: [
        ...(subnetId ? [{ targetResourceId: subnetId, type: "runs-in" as const }] : []),
      ],
      tags: {},
      networkInfo: {
        vpcId: vpcId || undefined,
        subnetId: subnetId || undefined,
        privateIps: privateIp ? [privateIp] : [],
        publicIps: publicIp ? [publicIp] : [],
      },
    });
  }

  return results;
}

function parseVpcs(xml: string, region: string): Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] {
  const results: Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] = [];
  const items = extractAllXmlBlocks(xml, "item");

  for (const item of items) {
    const vpcId = extractXmlValue(item, "vpcId");
    if (!vpcId) continue;

    const cidr = extractXmlValue(item, "cidrBlock");
    const isDefault = extractXmlValue(item, "isDefault") === "true";

    results.push({
      externalId: vpcId,
      provider: "aws",
      region,
      type: "vpc" as InfraResourceType,
      name: vpcId,
      properties: { cidr, isDefault },
      relationships: [],
      tags: {},
      networkInfo: { vpcId },
    });
  }

  return results;
}

function parseSubnets(xml: string, region: string): Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] {
  const results: Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] = [];
  const items = extractAllXmlBlocks(xml, "item");

  for (const item of items) {
    const subnetId = extractXmlValue(item, "subnetId");
    if (!subnetId) continue;

    const vpcId = extractXmlValue(item, "vpcId");
    const cidr = extractXmlValue(item, "cidrBlock");
    const az = extractXmlValue(item, "availabilityZone");
    const isPublic = extractXmlValue(item, "mapPublicIpOnLaunch") === "true";

    results.push({
      externalId: subnetId,
      provider: "aws",
      region,
      type: "subnet" as InfraResourceType,
      name: subnetId,
      properties: { cidr, az, public: isPublic },
      relationships: [{ targetResourceId: vpcId, type: "runs-in" }],
      tags: {},
      networkInfo: { vpcId, subnetId },
    });
  }

  return results;
}

function parseSecurityGroups(xml: string, region: string): Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] {
  const results: Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] = [];
  const items = extractAllXmlBlocks(xml, "item");

  for (const item of items) {
    const groupId = extractXmlValue(item, "groupId");
    if (!groupId) continue;

    const groupName = extractXmlValue(item, "groupName");
    const vpcId = extractXmlValue(item, "vpcId");
    const description = extractXmlValue(item, "groupDescription");

    results.push({
      externalId: groupId,
      provider: "aws",
      region,
      type: "security-group" as InfraResourceType,
      name: groupName || groupId,
      properties: { description },
      relationships: vpcId ? [{ targetResourceId: vpcId, type: "runs-in" }] : [],
      tags: {},
      networkInfo: { vpcId: vpcId || undefined },
    });
  }

  return results;
}

function parseLoadBalancers(xml: string, region: string): Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] {
  const results: Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] = [];
  const members = extractAllXmlBlocks(xml, "member");

  for (const member of members) {
    const name = extractXmlValue(member, "LoadBalancerName");
    if (!name) continue;

    const vpcId = extractXmlValue(member, "VpcId");
    const scheme = extractXmlValue(member, "Scheme");
    const type = extractXmlValue(member, "Type");
    const dnsName = extractXmlValue(member, "DNSName");

    results.push({
      externalId: name,
      provider: "aws",
      region,
      type: "load-balancer" as InfraResourceType,
      name,
      properties: { scheme, type: type || "application", dnsName },
      relationships: [],
      tags: {},
      networkInfo: { vpcId: vpcId || undefined },
    });
  }

  return results;
}
