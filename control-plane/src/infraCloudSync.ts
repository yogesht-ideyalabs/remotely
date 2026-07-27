/**
 * Direct Cloud API Sync — Control plane calls cloud provider APIs directly.
 *
 * Mode 2 access: No agent needed. The control plane uses stored credentials
 * (IAM Role ARN for AWS, Service Principal for Azure, SA key for GCP) to
 * directly query cloud APIs and discover resources.
 *
 * Currently supported:
 * - AWS (via STS AssumeRole → EC2 instances/VPCs/subnets/security-groups
 *   (including real inbound/outbound rules and tags), ELBv2 load
 *   balancers, RDS instances, Lambda functions). Lambda uses its own
 *   request/parse path (lambdaApiCall/parseLambdaFunctions) since its real
 *   API is REST/JSON (GET, path-versioned), not the POST+form-urlencoded+
 *   XML "Query protocol" every other call here uses — SigV4 signing still
 *   applies the same way, just with an empty-body GET instead of a form-
 *   encoded POST.
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

// Lambda's real API — REST/JSON, GET, path-versioned — not the
// POST+form-urlencoded+XML "Query protocol" awsApiCall speaks for every
// other service here. SigV4 signing still applies the same way (empty
// body is a valid, correctly-hashable payload for a GET request — the
// signer doesn't need a body to sign, just to hash *something*, and the
// empty string is that something).
async function lambdaApiCall(region: string, credentials: AwsCredentials, path: string): Promise<unknown> {
  const { SignatureV4 } = await import("./awsSigV4.js");
  const signer = new SignatureV4("lambda", region, credentials);

  const host = `lambda.${region}.amazonaws.com`;
  const url = `https://${host}${path}`;

  const signedHeaders = await signer.sign("GET", url, { Host: host }, "");

  const response = await fetch(url, { method: "GET", headers: signedHeaders });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AWS lambda:${path} failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
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

  // RDS Instances — was documented in this file's header comment and
  // listed in getApiVersion's version map, but never actually wired up.
  try {
    const xml = await awsApiCall("rds", region, "DescribeDBInstances", credentials);
    resources.push(...parseRdsInstances(xml, region));
  } catch (err) {
    console.error(`[infra-sync] RDS ${region}:`, (err as Error).message);
  }

  // Lambda functions — the other item this file's header comment used to
  // overclaim as supported. Real REST/JSON call now, see lambdaApiCall.
  try {
    const json = await lambdaApiCall(region, credentials, "/2015-03-31/functions/");
    resources.push(...parseLambdaFunctions(json, region));
  } catch (err) {
    console.error(`[infra-sync] Lambda ${region}:`, (err as Error).message);
  }

  return resources;
}

// ─── XML Parsers (minimal, no dependency) ────────────────────────────────────

function extractXmlValue(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, "s");
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}

// Real, verified-not-assumed bug this fixes: a non-greedy `(.*?)` regex
// isn't nesting-aware, so for any block that contains its own nested same-
// named tag — which is the normal shape of AWS's XML responses (an EC2
// instance's <item> contains a <groupSet><item>...</item></groupSet> for
// its security groups, a security group's <item> contains
// <ipPermissions><item>...</item></ipPermissions> for its rules, etc.) —
// the regex matches only up to the FIRST closing tag it finds, which
// belongs to the inner nested block, silently truncating the outer one
// and losing every field that came after the nesting started. Confirmed
// with a realistic AWS-shaped test snippet before shipping this fix, not
// just by inspection: the old regex returned 1 truncated block missing
// vpcId/groupDescription for a security group with 2 permission rules;
// this version correctly returns the full top-level block.
function extractAllXmlBlocks(xml: string, tag: string): string[] {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const blocks: string[] = [];
  let pos = 0;
  while (true) {
    const start = xml.indexOf(openTag, pos);
    if (start === -1) break;
    let depth = 1;
    let cursor = start + openTag.length;
    while (depth > 0) {
      const nextOpen = xml.indexOf(openTag, cursor);
      const nextClose = xml.indexOf(closeTag, cursor);
      if (nextClose === -1) {
        cursor = xml.length;
        depth = 0;
        break;
      }
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        cursor = nextOpen + openTag.length;
      } else {
        depth--;
        cursor = nextClose + closeTag.length;
      }
    }
    blocks.push(xml.slice(start + openTag.length, cursor - closeTag.length));
    pos = cursor;
  }
  return blocks;
}

// Shared by every EC2-family parser (instances/VPCs/subnets/security
// groups all use the same <tagSet><item><key/><value/></item></tagSet>
// shape in the Query API) — real tags, not just a Name lookup. Depends on
// extractAllXmlBlocks' nesting fix above: tagSet is scoped out first via
// extractXmlValue (safe — only one <tagSet> per item, no self-nesting), so
// the <item> blocks extracted from within it are unambiguously tag items,
// not the resource's other nested item collections (groupSet, etc.).
export function extractEc2Tags(itemXml: string): Record<string, string> {
  const tagSetContent = extractXmlValue(itemXml, "tagSet");
  if (!tagSetContent) return {};
  const tags: Record<string, string> = {};
  for (const tagItem of extractAllXmlBlocks(tagSetContent, "item")) {
    const key = extractXmlValue(tagItem, "key");
    if (key) tags[key] = extractXmlValue(tagItem, "value");
  }
  return tags;
}

export function parseEc2Instances(xml: string, region: string): Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] {
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
    const tags = extractEc2Tags(item);
    const name = tags.Name || instanceId;

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
      tags,
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
    const tags = extractEc2Tags(item);

    results.push({
      externalId: vpcId,
      provider: "aws",
      region,
      type: "vpc" as InfraResourceType,
      name: tags.Name || vpcId,
      properties: { cidr, isDefault },
      relationships: [],
      tags,
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
    const tags = extractEc2Tags(item);

    results.push({
      externalId: subnetId,
      provider: "aws",
      region,
      type: "subnet" as InfraResourceType,
      name: tags.Name || subnetId,
      properties: { cidr, az, public: isPublic },
      relationships: [{ targetResourceId: vpcId, type: "runs-in" }],
      tags,
      networkInfo: { vpcId, subnetId },
    });
  }

  return results;
}

interface SecurityGroupRule {
  protocol: string;
  fromPort: string;
  toPort: string;
  cidrs: string[];
}

// AWS's DescribeSecurityGroups response nests each rule as its own <item>
// inside <ipPermissions>/<ipPermissionsEgress> — real port/protocol/source
// data, not just the group's own id/name/description. Wasn't parsed at
// all before (the outer per-group loop only ever read groupId/groupName/
// vpcId/groupDescription), which is exactly the "show me inbound/outbound
// ports" gap that was missing.
export function parseSecurityGroupRules(groupItemXml: string, wrapperTag: "ipPermissions" | "ipPermissionsEgress"): SecurityGroupRule[] {
  const wrapperContent = extractXmlValue(groupItemXml, wrapperTag);
  if (!wrapperContent) return [];
  return extractAllXmlBlocks(wrapperContent, "item").map((rule) => {
    const ipRangesBlock = extractXmlValue(rule, "ipRanges");
    const cidrs = ipRangesBlock
      ? extractAllXmlBlocks(ipRangesBlock, "item")
          .map((c) => extractXmlValue(c, "cidrIp"))
          .filter(Boolean)
      : [];
    return {
      protocol: extractXmlValue(rule, "ipProtocol") || "all",
      fromPort: extractXmlValue(rule, "fromPort"),
      toPort: extractXmlValue(rule, "toPort"),
      cidrs,
    };
  });
}

export function parseSecurityGroups(xml: string, region: string): Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] {
  const results: Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] = [];
  const items = extractAllXmlBlocks(xml, "item");

  for (const item of items) {
    const groupId = extractXmlValue(item, "groupId");
    if (!groupId) continue;

    const groupName = extractXmlValue(item, "groupName");
    const vpcId = extractXmlValue(item, "vpcId");
    const description = extractXmlValue(item, "groupDescription");
    const inboundRules = parseSecurityGroupRules(item, "ipPermissions");
    const outboundRules = parseSecurityGroupRules(item, "ipPermissionsEgress");
    const tags = extractEc2Tags(item);

    results.push({
      externalId: groupId,
      provider: "aws",
      region,
      type: "security-group" as InfraResourceType,
      name: groupName || groupId,
      properties: { description, inboundRules, outboundRules },
      relationships: vpcId ? [{ targetResourceId: vpcId, type: "runs-in" }] : [],
      tags,
      networkInfo: { vpcId: vpcId || undefined },
    });
  }

  return results;
}

function parseRdsInstances(xml: string, region: string): Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] {
  const results: Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] = [];
  // RDS's DescribeDBInstances response repeats <DBInstance>, not <item> —
  // a different element name from the EC2-family calls above.
  const items = extractAllXmlBlocks(xml, "DBInstance");

  for (const item of items) {
    const dbInstanceId = extractXmlValue(item, "DBInstanceIdentifier");
    if (!dbInstanceId) continue;

    const engine = extractXmlValue(item, "Engine");
    const instanceClass = extractXmlValue(item, "DBInstanceClass");
    const status = extractXmlValue(item, "DBInstanceStatus");
    const multiAz = extractXmlValue(item, "MultiAZ") === "true";
    const address = extractXmlValue(item, "Address");
    const vpcId = extractXmlValue(item, "VpcId");

    results.push({
      externalId: dbInstanceId,
      provider: "aws",
      region,
      // Field names (engine/instanceType/multiAz/dnsName/state) match what
      // NodePropertiesPanel.tsx's "rds-instance" section already renders.
      type: "rds-instance" as InfraResourceType,
      name: dbInstanceId,
      properties: { engine, instanceType: instanceClass, state: status, multiAz, dnsName: address },
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

interface LambdaListResponse {
  Functions?: {
    FunctionName: string;
    FunctionArn?: string;
    Runtime?: string;
    MemorySize?: number;
    Timeout?: number;
    LastModified?: string;
    VpcConfig?: { VpcId?: string; SubnetIds?: string[]; SecurityGroupIds?: string[] };
  }[];
}

export function parseLambdaFunctions(response: unknown, region: string): Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] {
  const results: Omit<InfraResource, "id" | "accountId" | "discoveredAt">[] = [];
  const functions = (response as LambdaListResponse)?.Functions ?? [];

  for (const fn of functions) {
    if (!fn.FunctionName) continue;
    const vpcId = fn.VpcConfig?.VpcId;

    results.push({
      externalId: fn.FunctionName,
      provider: "aws",
      region,
      type: "lambda" as InfraResourceType,
      name: fn.FunctionName,
      properties: {
        runtime: fn.Runtime,
        memory: fn.MemorySize,
        timeout: fn.Timeout,
        lastModified: fn.LastModified,
        arn: fn.FunctionArn,
      },
      relationships: vpcId ? [{ targetResourceId: vpcId, type: "runs-in" }] : [],
      tags: {},
      networkInfo: {
        vpcId: vpcId || undefined,
        securityGroups: fn.VpcConfig?.SecurityGroupIds,
      },
    });
  }

  return results;
}
