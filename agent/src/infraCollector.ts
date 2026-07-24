/**
 * Infrastructure Collector for the Remotely Agent
 *
 * When an agent runs inside a cloud environment (or on-prem hypervisor), it can
 * discover neighboring resources and report them back to the control plane.
 *
 * Supported providers:
 * - AWS (via instance metadata + SDK calls with the instance's IAM role)
 * - VMware/vSphere (via govmomi or direct API calls)
 * - Proxmox (via Proxmox REST API)
 * - Generic (network scan / system info)
 *
 * The agent reports what it finds to the control plane's /api/infra/resources/sync
 * endpoint. The control plane builds the unified graph + diagrams from there.
 */

import os from "node:os";
import { execSync } from "node:child_process";
import { collectDockerContainers, collectListeningServices } from "./dockerCollector.js";

export interface DiscoveredResource {
  externalId: string;
  provider: string;
  region: string;
  type: string;
  name: string;
  properties: Record<string, unknown>;
  relationships: { targetResourceId: string; type: string }[];
  tags: Record<string, string>;
  networkInfo?: {
    vpcId?: string;
    subnetId?: string;
    privateIps?: string[];
    publicIps?: string[];
    securityGroups?: string[];
  };
  reportedByAgent?: string;
}

export interface InfraCollectorConfig {
  enabled: boolean;
  provider: "aws" | "vmware" | "proxmox" | "generic" | "auto";
  // For VMware/Proxmox: API endpoint + credentials
  apiEndpoint?: string;
  apiToken?: string;
  apiUser?: string;
  apiPassword?: string;
  // For AWS: region override (else uses instance metadata)
  awsRegion?: string;
  // How often to run discovery (minutes)
  intervalMinutes: number;
  // Which infra account ID to report under (set by control plane on registration)
  infraAccountId?: string;
}

const DEFAULT_CONFIG: InfraCollectorConfig = {
  enabled: false,
  provider: "auto",
  intervalMinutes: 15,
};

/**
 * Auto-detect which cloud provider this agent is running on.
 */
export async function detectProvider(): Promise<"aws" | "vmware" | "proxmox" | "generic"> {
  // Check AWS metadata service
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const resp = await fetch("http://169.254.169.254/latest/meta-data/instance-id", {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (resp.ok) return "aws";
  } catch {}

  // Check for VMware tools
  try {
    execSync("vmware-toolbox-cmd stat speed 2>/dev/null", { encoding: "utf8" });
    return "vmware";
  } catch {}

  // Check for Proxmox (qemu guest agent or /etc/pve)
  try {
    const content = execSync("cat /sys/class/dmi/id/product_name 2>/dev/null", { encoding: "utf8" });
    if (content.toLowerCase().includes("qemu") || content.toLowerCase().includes("proxmox")) {
      return "proxmox";
    }
  } catch {}

  return "generic";
}

/**
 * Collect AWS infrastructure resources visible to this instance's IAM role.
 * Uses the AWS SDK (via CLI or direct HTTP to SDK endpoints).
 */
export async function collectAwsResources(region?: string): Promise<DiscoveredResource[]> {
  const resources: DiscoveredResource[] = [];

  try {
    // Get instance identity from metadata
    const identityResp = await fetch(
      "http://169.254.169.254/latest/dynamic/instance-identity/document"
    );
    const identity = await identityResp.json() as {
      region: string;
      instanceId: string;
      accountId: string;
    };
    const awsRegion = region || identity.region;

    // Use AWS CLI (available if aws-cli is installed) to describe resources
    // This is simpler than bundling the full AWS SDK in the agent binary

    // EC2 Instances
    const ec2Json = execSync(
      `aws ec2 describe-instances --region ${awsRegion} --output json 2>/dev/null`,
      { encoding: "utf8", timeout: 30000 }
    );
    const ec2Data = JSON.parse(ec2Json);
    for (const reservation of ec2Data.Reservations || []) {
      for (const instance of reservation.Instances || []) {
        const name = (instance.Tags || []).find((t: { Key: string }) => t.Key === "Name")?.Value || instance.InstanceId;
        resources.push({
          externalId: instance.InstanceId,
          provider: "aws",
          region: awsRegion,
          type: "vm",
          name,
          properties: {
            instanceType: instance.InstanceType,
            state: instance.State?.Name,
            launchTime: instance.LaunchTime,
            platform: instance.Platform || "linux",
            ami: instance.ImageId,
          },
          relationships: [
            ...(instance.SubnetId ? [{ targetResourceId: instance.SubnetId, type: "runs-in" }] : []),
            ...(instance.SecurityGroups || []).map((sg: { GroupId: string }) => ({
              targetResourceId: sg.GroupId,
              type: "member-of",
            })),
          ],
          tags: Object.fromEntries(
            (instance.Tags || []).map((t: { Key: string; Value: string }) => [t.Key, t.Value])
          ),
          networkInfo: {
            vpcId: instance.VpcId,
            subnetId: instance.SubnetId,
            privateIps: instance.PrivateIpAddress ? [instance.PrivateIpAddress] : [],
            publicIps: instance.PublicIpAddress ? [instance.PublicIpAddress] : [],
            securityGroups: (instance.SecurityGroups || []).map((sg: { GroupId: string }) => sg.GroupId),
          },
        });
      }
    }

    // VPCs
    const vpcJson = execSync(
      `aws ec2 describe-vpcs --region ${awsRegion} --output json 2>/dev/null`,
      { encoding: "utf8", timeout: 30000 }
    );
    const vpcData = JSON.parse(vpcJson);
    for (const vpc of vpcData.Vpcs || []) {
      const name = (vpc.Tags || []).find((t: { Key: string }) => t.Key === "Name")?.Value || vpc.VpcId;
      resources.push({
        externalId: vpc.VpcId,
        provider: "aws",
        region: awsRegion,
        type: "vpc",
        name,
        properties: { cidr: vpc.CidrBlock, isDefault: vpc.IsDefault, state: vpc.State },
        relationships: [],
        tags: Object.fromEntries(
          (vpc.Tags || []).map((t: { Key: string; Value: string }) => [t.Key, t.Value])
        ),
        networkInfo: { vpcId: vpc.VpcId },
      });
    }

    // Subnets
    const subnetJson = execSync(
      `aws ec2 describe-subnets --region ${awsRegion} --output json 2>/dev/null`,
      { encoding: "utf8", timeout: 30000 }
    );
    const subnetData = JSON.parse(subnetJson);
    for (const subnet of subnetData.Subnets || []) {
      const name = (subnet.Tags || []).find((t: { Key: string }) => t.Key === "Name")?.Value || subnet.SubnetId;
      resources.push({
        externalId: subnet.SubnetId,
        provider: "aws",
        region: awsRegion,
        type: "subnet",
        name,
        properties: {
          cidr: subnet.CidrBlock,
          az: subnet.AvailabilityZone,
          public: subnet.MapPublicIpOnLaunch,
        },
        relationships: [{ targetResourceId: subnet.VpcId, type: "runs-in" }],
        tags: Object.fromEntries(
          (subnet.Tags || []).map((t: { Key: string; Value: string }) => [t.Key, t.Value])
        ),
        networkInfo: { vpcId: subnet.VpcId, subnetId: subnet.SubnetId },
      });
    }

    // Security Groups
    const sgJson = execSync(
      `aws ec2 describe-security-groups --region ${awsRegion} --output json 2>/dev/null`,
      { encoding: "utf8", timeout: 30000 }
    );
    const sgData = JSON.parse(sgJson);
    for (const sg of sgData.SecurityGroups || []) {
      resources.push({
        externalId: sg.GroupId,
        provider: "aws",
        region: awsRegion,
        type: "security-group",
        name: sg.GroupName,
        properties: {
          description: sg.Description,
          ingressRules: (sg.IpPermissions || []).length,
          egressRules: (sg.IpPermissionsEgress || []).length,
        },
        relationships: [{ targetResourceId: sg.VpcId, type: "runs-in" }],
        tags: Object.fromEntries(
          (sg.Tags || []).map((t: { Key: string; Value: string }) => [t.Key, t.Value])
        ),
        networkInfo: { vpcId: sg.VpcId },
      });
    }

    // Load Balancers
    try {
      const elbJson = execSync(
        `aws elbv2 describe-load-balancers --region ${awsRegion} --output json 2>/dev/null`,
        { encoding: "utf8", timeout: 30000 }
      );
      const elbData = JSON.parse(elbJson);
      for (const lb of elbData.LoadBalancers || []) {
        const subnetIds = (lb.AvailabilityZones || []).map((az: { SubnetId: string }) => az.SubnetId);
        resources.push({
          externalId: lb.LoadBalancerArn?.split("/").pop() || lb.LoadBalancerName,
          provider: "aws",
          region: awsRegion,
          type: "load-balancer",
          name: lb.LoadBalancerName,
          properties: {
            type: lb.Type,
            scheme: lb.Scheme,
            dnsName: lb.DNSName,
            state: lb.State?.Code,
          },
          relationships: subnetIds.map((sid: string) => ({ targetResourceId: sid, type: "runs-in" })),
          tags: {},
          networkInfo: {
            vpcId: lb.VpcId,
            securityGroups: lb.SecurityGroups || [],
          },
        });
      }
    } catch {}

    // RDS instances
    try {
      const rdsJson = execSync(
        `aws rds describe-db-instances --region ${awsRegion} --output json 2>/dev/null`,
        { encoding: "utf8", timeout: 30000 }
      );
      const rdsData = JSON.parse(rdsJson);
      for (const db of rdsData.DBInstances || []) {
        const subnetIds = (db.DBSubnetGroup?.Subnets || []).map((s: { SubnetIdentifier: string }) => s.SubnetIdentifier);
        resources.push({
          externalId: db.DBInstanceIdentifier,
          provider: "aws",
          region: awsRegion,
          type: "rds-instance",
          name: db.DBInstanceIdentifier,
          properties: {
            engine: db.Engine,
            engineVersion: db.EngineVersion,
            instanceClass: db.DBInstanceClass,
            multiAz: db.MultiAZ,
            state: db.DBInstanceStatus,
            endpoint: db.Endpoint?.Address,
          },
          relationships: subnetIds.map((sid: string) => ({ targetResourceId: sid, type: "runs-in" })),
          tags: {},
          networkInfo: {
            vpcId: db.DBSubnetGroup?.VpcId,
            securityGroups: (db.VpcSecurityGroups || []).map((sg: { VpcSecurityGroupId: string }) => sg.VpcSecurityGroupId),
          },
        });
      }
    } catch {}

    // Lambda functions
    try {
      const lambdaJson = execSync(
        `aws lambda list-functions --region ${awsRegion} --output json 2>/dev/null`,
        { encoding: "utf8", timeout: 30000 }
      );
      const lambdaData = JSON.parse(lambdaJson);
      for (const fn of lambdaData.Functions || []) {
        const vpcConfig = fn.VpcConfig || {};
        resources.push({
          externalId: fn.FunctionName,
          provider: "aws",
          region: awsRegion,
          type: "lambda",
          name: fn.FunctionName,
          properties: {
            runtime: fn.Runtime,
            memory: fn.MemorySize,
            timeout: fn.Timeout,
            handler: fn.Handler,
          },
          relationships: (vpcConfig.SubnetIds || []).map((sid: string) => ({
            targetResourceId: sid,
            type: "runs-in",
          })),
          tags: {},
          networkInfo: {
            vpcId: vpcConfig.VpcId || undefined,
            securityGroups: vpcConfig.SecurityGroupIds || [],
          },
        });
      }
    } catch {}

    // NAT Gateways
    try {
      const natJson = execSync(
        `aws ec2 describe-nat-gateways --region ${awsRegion} --filter "Name=state,Values=available" --output json 2>/dev/null`,
        { encoding: "utf8", timeout: 30000 }
      );
      const natData = JSON.parse(natJson);
      for (const nat of natData.NatGateways || []) {
        const name = (nat.Tags || []).find((t: { Key: string }) => t.Key === "Name")?.Value || nat.NatGatewayId;
        resources.push({
          externalId: nat.NatGatewayId,
          provider: "aws",
          region: awsRegion,
          type: "nat-gateway",
          name,
          properties: {
            publicIp: nat.NatGatewayAddresses?.[0]?.PublicIp,
          },
          relationships: [{ targetResourceId: nat.SubnetId, type: "runs-in" }],
          tags: Object.fromEntries(
            (nat.Tags || []).map((t: { Key: string; Value: string }) => [t.Key, t.Value])
          ),
          networkInfo: { vpcId: nat.VpcId, subnetId: nat.SubnetId },
        });
      }
    } catch {}

    // Internet Gateways
    try {
      const igwJson = execSync(
        `aws ec2 describe-internet-gateways --region ${awsRegion} --output json 2>/dev/null`,
        { encoding: "utf8", timeout: 30000 }
      );
      const igwData = JSON.parse(igwJson);
      for (const igw of igwData.InternetGateways || []) {
        const name = (igw.Tags || []).find((t: { Key: string }) => t.Key === "Name")?.Value || igw.InternetGatewayId;
        const attachedVpc = igw.Attachments?.find((a: { State: string }) => a.State === "available")?.VpcId;
        resources.push({
          externalId: igw.InternetGatewayId,
          provider: "aws",
          region: awsRegion,
          type: "internet-gateway",
          name,
          properties: {},
          relationships: attachedVpc ? [{ targetResourceId: attachedVpc, type: "attached-to" }] : [],
          tags: Object.fromEntries(
            (igw.Tags || []).map((t: { Key: string; Value: string }) => [t.Key, t.Value])
          ),
          networkInfo: { vpcId: attachedVpc },
        });
      }
    } catch {}

  } catch (err) {
    console.error("[infra-collector] AWS discovery failed:", (err as Error).message);
  }

  return resources;
}

/**
 * Collect Proxmox infrastructure via its REST API.
 */
export async function collectProxmoxResources(
  apiEndpoint: string,
  apiToken: string
): Promise<DiscoveredResource[]> {
  const resources: DiscoveredResource[] = [];
  const headers = { Authorization: `PVEAPIToken=${apiToken}` };

  try {
    // Get nodes
    const nodesResp = await fetch(`${apiEndpoint}/api2/json/nodes`, { headers });
    const nodesData = await nodesResp.json() as { data: Array<{ node: string; status: string; cpu: number; mem: number; maxmem: number }> };

    for (const node of nodesData.data || []) {
      resources.push({
        externalId: `pve-node-${node.node}`,
        provider: "proxmox",
        region: "local",
        type: "proxmox-node",
        name: node.node,
        properties: {
          status: node.status,
          cpu: node.cpu,
          memory: node.mem,
          maxMemory: node.maxmem,
        },
        relationships: [],
        tags: {},
      });

      // Get VMs for this node
      const vmsResp = await fetch(`${apiEndpoint}/api2/json/nodes/${node.node}/qemu`, { headers });
      const vmsData = await vmsResp.json() as { data: Array<{ vmid: number; name: string; status: string; cpus: number; mem: number; maxmem: number; netin: number; netout: number }> };

      for (const vm of vmsData.data || []) {
        resources.push({
          externalId: `pve-vm-${vm.vmid}`,
          provider: "proxmox",
          region: "local",
          type: "proxmox-vm",
          name: vm.name || `VM ${vm.vmid}`,
          properties: {
            vmid: vm.vmid,
            status: vm.status,
            cpus: vm.cpus,
            memory: vm.mem,
            maxMemory: vm.maxmem,
            netIn: vm.netin,
            netOut: vm.netout,
          },
          relationships: [{ targetResourceId: `pve-node-${node.node}`, type: "runs-in" }],
          tags: {},
        });
      }

      // Get containers (LXC) for this node
      const lxcResp = await fetch(`${apiEndpoint}/api2/json/nodes/${node.node}/lxc`, { headers });
      const lxcData = await lxcResp.json() as { data: Array<{ vmid: number; name: string; status: string; cpus: number; mem: number; maxmem: number }> };

      for (const ct of lxcData.data || []) {
        resources.push({
          externalId: `pve-ct-${ct.vmid}`,
          provider: "proxmox",
          region: "local",
          type: "proxmox-container",
          name: ct.name || `CT ${ct.vmid}`,
          properties: {
            vmid: ct.vmid,
            status: ct.status,
            cpus: ct.cpus,
            memory: ct.mem,
            maxMemory: ct.maxmem,
          },
          relationships: [{ targetResourceId: `pve-node-${node.node}`, type: "runs-in" }],
          tags: {},
        });
      }
    }
  } catch (err) {
    console.error("[infra-collector] Proxmox discovery failed:", (err as Error).message);
  }

  return resources;
}

/**
 * Collect generic system information (useful for on-prem / unknown environments).
 */
export function collectGenericResources(agentId: string): DiscoveredResource[] {
  const ifaces = os.networkInterfaces();
  const privateIps: string[] = [];

  for (const entries of Object.values(ifaces)) {
    for (const entry of entries || []) {
      if (!entry.internal && entry.family === "IPv4") {
        privateIps.push(entry.address);
      }
    }
  }

  const resources: DiscoveredResource[] = [
    {
      externalId: `host-${agentId}`,
      provider: "on-prem",
      region: "local",
      type: "vm",
      name: os.hostname(),
      properties: {
        os: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        uptime: os.uptime(),
      },
      relationships: [],
      tags: { hostname: os.hostname() },
      networkInfo: { privateIps },
      reportedByAgent: agentId,
    },
  ];

  // Also discover Docker containers and listening services
  resources.push(...collectDockerContainers());
  resources.push(...collectListeningServices());

  return resources;
}

/**
 * Run a full infrastructure collection cycle.
 */
export async function runCollection(
  config: InfraCollectorConfig,
  agentId: string
): Promise<DiscoveredResource[]> {
  let provider = config.provider;
  if (provider === "auto") {
    provider = await detectProvider();
    console.log(`[infra-collector] Auto-detected provider: ${provider}`);
  }

  switch (provider) {
    case "aws":
      return collectAwsResources(config.awsRegion);
    case "proxmox":
      if (config.apiEndpoint && config.apiToken) {
        return collectProxmoxResources(config.apiEndpoint, config.apiToken);
      }
      console.warn("[infra-collector] Proxmox configured but missing apiEndpoint/apiToken");
      return collectGenericResources(agentId);
    case "vmware":
      // VMware requires govmomi or pyvmomi — placeholder for now
      console.warn("[infra-collector] VMware discovery not yet implemented, falling back to generic");
      return collectGenericResources(agentId);
    default:
      return collectGenericResources(agentId);
  }
}
