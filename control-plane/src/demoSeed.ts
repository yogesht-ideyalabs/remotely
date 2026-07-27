/**
 * Demo infrastructure seed data — three realistic multi-cloud "projects"
 * (one AWS, one Azure, one GCP account, each with ~10 interconnected
 * resources) so the Architecture page and diagram tooling have something
 * real to render without needing live cloud credentials.
 *
 * Idempotent: re-running skips any project account that already exists by
 * name, so this is safe to call from a UI button repeatedly.
 */

import {
  createInfraAccount,
  upsertInfraResources,
  listInfraAccounts,
  type InfraAccount,
  type InfraResource,
} from "./infraDiscovery.js";

type SeedResource = Omit<InfraResource, "id" | "accountId" | "discoveredAt">;

interface ProjectSeed {
  accountName: string;
  provider: InfraAccount["provider"];
  accountId: string;
  regions: string[];
  resources: SeedResource[];
}

const AWS_PROJECT: ProjectSeed = {
  accountName: "project-aws",
  provider: "aws",
  accountId: "123456789012",
  regions: ["us-east-1"],
  resources: [
    {
      externalId: "vpc-aws01", name: "aws-prod-vpc", provider: "aws", region: "us-east-1", type: "vpc",
      properties: { cidr: "10.0.0.0/16", state: "available" },
      tags: { Name: "aws-prod-vpc", Environment: "production", Project: "project-aws" },
      relationships: [],
    },
    {
      externalId: "subnet-aws-pub1", name: "aws-public-subnet-1a", provider: "aws", region: "us-east-1", type: "subnet",
      properties: { cidr: "10.0.1.0/24", public: true, availabilityZone: "us-east-1a" },
      tags: { Name: "aws-public-subnet-1a", Environment: "production" },
      networkInfo: { vpcId: "vpc-aws01" },
      relationships: [{ targetResourceId: "vpc-aws01", type: "contains" }],
    },
    {
      externalId: "subnet-aws-priv1", name: "aws-private-subnet-1a", provider: "aws", region: "us-east-1", type: "subnet",
      properties: { cidr: "10.0.2.0/24", public: false, availabilityZone: "us-east-1a" },
      tags: { Name: "aws-private-subnet-1a", Environment: "production" },
      networkInfo: { vpcId: "vpc-aws01" },
      relationships: [{ targetResourceId: "vpc-aws01", type: "contains" }],
    },
    {
      externalId: "sg-aws01", name: "aws-web-sg", provider: "aws", region: "us-east-1", type: "security-group",
      properties: {
        inboundRules: [
          { protocol: "tcp", fromPort: "443", toPort: "443", cidrs: ["0.0.0.0/0"] },
          { protocol: "tcp", fromPort: "22", toPort: "22", cidrs: ["10.0.0.0/16"] },
        ],
        outboundRules: [{ protocol: "-1", fromPort: "", toPort: "", cidrs: ["0.0.0.0/0"] }],
      },
      tags: { Name: "aws-web-sg" },
      networkInfo: { vpcId: "vpc-aws01" },
      relationships: [],
    },
    {
      externalId: "i-aws-web1", name: "aws-web-server-1", provider: "aws", region: "us-east-1", type: "vm",
      properties: { instanceType: "t3.medium", state: "running", ami: "ami-0abcdef1234567890" },
      tags: { Name: "aws-web-server-1", Environment: "production", Owner: "platform-team" },
      networkInfo: { vpcId: "vpc-aws01", subnetId: "subnet-aws-pub1", privateIps: ["10.0.1.10"], publicIps: ["54.23.11.9"], securityGroups: ["sg-aws01"] },
      relationships: [{ targetResourceId: "subnet-aws-pub1", type: "runs-in" }, { targetResourceId: "sg-aws01", type: "member-of" }],
    },
    {
      externalId: "i-aws-app1", name: "aws-app-server-1", provider: "aws", region: "us-east-1", type: "vm",
      properties: { instanceType: "t3.large", state: "running", ami: "ami-0abcdef1234567890" },
      tags: { Name: "aws-app-server-1", Environment: "production", Owner: "platform-team" },
      networkInfo: { vpcId: "vpc-aws01", subnetId: "subnet-aws-priv1", privateIps: ["10.0.2.15"], securityGroups: ["sg-aws01"] },
      relationships: [{ targetResourceId: "subnet-aws-priv1", type: "runs-in" }, { targetResourceId: "sg-aws01", type: "member-of" }],
    },
    {
      externalId: "fn-aws-processor", name: "aws-image-processor", provider: "aws", region: "us-east-1", type: "lambda",
      properties: { runtime: "nodejs20.x", memorySize: 512, timeout: 30, state: "Active" },
      tags: { Name: "aws-image-processor", Environment: "production" },
      relationships: [],
    },
    {
      externalId: "aws-assets-bucket", name: "aws-assets-bucket", provider: "aws", region: "us-east-1", type: "s3-bucket",
      properties: { versioning: "Enabled", encryption: "AES256" },
      tags: { Name: "aws-assets-bucket", Environment: "production" },
      relationships: [],
    },
    {
      externalId: "db-aws-prod", name: "aws-prod-postgres", provider: "aws", region: "us-east-1", type: "rds-instance",
      properties: { engine: "postgres", engineVersion: "15.4", instanceClass: "db.t3.medium", multiAz: true, state: "available" },
      tags: { Name: "aws-prod-postgres", Environment: "production" },
      networkInfo: { vpcId: "vpc-aws01", subnetId: "subnet-aws-priv1" },
      relationships: [{ targetResourceId: "subnet-aws-priv1", type: "runs-in" }],
    },
    {
      externalId: "alb-aws-prod", name: "aws-prod-alb", provider: "aws", region: "us-east-1", type: "load-balancer",
      properties: { scheme: "internet-facing", listeners: "443/HTTPS, 80/HTTP", healthCheck: "/healthz", connectedServices: "aws-web-server-1" },
      tags: { Name: "aws-prod-alb", Environment: "production" },
      networkInfo: { vpcId: "vpc-aws01" },
      relationships: [{ targetResourceId: "i-aws-web1", type: "targets" }],
    },
    {
      externalId: "igw-aws01", name: "aws-igw", provider: "aws", region: "us-east-1", type: "internet-gateway",
      properties: { state: "attached" },
      tags: { Name: "aws-igw" },
      networkInfo: { vpcId: "vpc-aws01" },
      relationships: [{ targetResourceId: "vpc-aws01", type: "attached-to" }],
    },
    {
      externalId: "nat-aws01", name: "aws-nat-gw", provider: "aws", region: "us-east-1", type: "nat-gateway",
      properties: { state: "available" },
      tags: { Name: "aws-nat-gw" },
      networkInfo: { vpcId: "vpc-aws01", subnetId: "subnet-aws-pub1" },
      relationships: [{ targetResourceId: "vpc-aws01", type: "attached-to" }],
    },
  ],
};

const AZURE_PROJECT: ProjectSeed = {
  accountName: "project-azure",
  provider: "azure",
  accountId: "11112222-3333-4444-5555-666677778888",
  regions: ["eastus"],
  resources: [
    {
      externalId: "vnet-azure01", name: "azure-prod-vnet", provider: "azure", region: "eastus", type: "vpc",
      properties: { cidr: "10.10.0.0/16", state: "Succeeded" },
      tags: { Name: "azure-prod-vnet", Environment: "production", Project: "project-azure" },
      relationships: [],
    },
    {
      externalId: "subnet-azure-web", name: "azure-web-subnet", provider: "azure", region: "eastus", type: "subnet",
      properties: { cidr: "10.10.1.0/24", public: true },
      tags: { Name: "azure-web-subnet" },
      networkInfo: { vpcId: "vnet-azure01" },
      relationships: [{ targetResourceId: "vnet-azure01", type: "contains" }],
    },
    {
      externalId: "subnet-azure-data", name: "azure-data-subnet", provider: "azure", region: "eastus", type: "subnet",
      properties: { cidr: "10.10.2.0/24", public: false },
      tags: { Name: "azure-data-subnet" },
      networkInfo: { vpcId: "vnet-azure01" },
      relationships: [{ targetResourceId: "vnet-azure01", type: "contains" }],
    },
    {
      externalId: "nsg-azure01", name: "azure-web-nsg", provider: "azure", region: "eastus", type: "security-group",
      properties: {
        inboundRules: [
          { protocol: "tcp", fromPort: "443", toPort: "443", cidrs: ["*"] },
          { protocol: "tcp", fromPort: "3389", toPort: "3389", cidrs: ["10.10.0.0/16"] },
        ],
        outboundRules: [{ protocol: "-1", fromPort: "", toPort: "", cidrs: ["*"] }],
      },
      tags: { Name: "azure-web-nsg" },
      networkInfo: { vpcId: "vnet-azure01" },
      relationships: [],
    },
    {
      externalId: "vm-azure-web1", name: "azure-web-vm-1", provider: "azure", region: "eastus", type: "vm",
      properties: { instanceType: "Standard_D2s_v5", state: "running" },
      tags: { Name: "azure-web-vm-1", Environment: "production", Owner: "platform-team" },
      networkInfo: { vpcId: "vnet-azure01", subnetId: "subnet-azure-web", privateIps: ["10.10.1.4"], publicIps: ["20.55.12.31"], securityGroups: ["nsg-azure01"] },
      relationships: [{ targetResourceId: "subnet-azure-web", type: "runs-in" }, { targetResourceId: "nsg-azure01", type: "member-of" }],
    },
    {
      externalId: "vm-azure-app1", name: "azure-app-vm-1", provider: "azure", region: "eastus", type: "vm",
      properties: { instanceType: "Standard_D4s_v5", state: "running" },
      tags: { Name: "azure-app-vm-1", Environment: "production", Owner: "platform-team" },
      networkInfo: { vpcId: "vnet-azure01", subnetId: "subnet-azure-data", privateIps: ["10.10.2.8"], securityGroups: ["nsg-azure01"] },
      relationships: [{ targetResourceId: "subnet-azure-data", type: "runs-in" }, { targetResourceId: "nsg-azure01", type: "member-of" }],
    },
    {
      externalId: "st-azureassets", name: "azureprodassets", provider: "azure", region: "eastus", type: "storage-account",
      properties: { sku: "Standard_LRS", accessTier: "Hot" },
      tags: { Name: "azureprodassets", Environment: "production" },
      relationships: [],
    },
    {
      externalId: "sql-azure-prod", name: "azure-prod-sql", provider: "azure", region: "eastus", type: "rds-instance",
      properties: { engine: "sqlserver", engineVersion: "15.0", instanceClass: "GP_Gen5_4", multiAz: true, state: "Online" },
      tags: { Name: "azure-prod-sql", Environment: "production" },
      networkInfo: { vpcId: "vnet-azure01", subnetId: "subnet-azure-data" },
      relationships: [{ targetResourceId: "subnet-azure-data", type: "runs-in" }],
    },
    {
      externalId: "fn-azure-notify", name: "azure-notify-function", provider: "azure", region: "eastus", type: "lambda",
      properties: { runtime: "dotnet8", memorySize: 1536, timeout: 60, state: "Running" },
      tags: { Name: "azure-notify-function", Environment: "production" },
      relationships: [],
    },
    {
      externalId: "lb-azure-prod", name: "azure-prod-lb", provider: "azure", region: "eastus", type: "load-balancer",
      properties: { scheme: "public", listeners: "443/HTTPS", healthCheck: "/health", connectedServices: "azure-web-vm-1" },
      tags: { Name: "azure-prod-lb", Environment: "production" },
      networkInfo: { vpcId: "vnet-azure01" },
      relationships: [{ targetResourceId: "vm-azure-web1", type: "targets" }],
    },
    {
      externalId: "pip-azure01", name: "azure-public-gateway", provider: "azure", region: "eastus", type: "internet-gateway",
      properties: { state: "Succeeded" },
      tags: { Name: "azure-public-gateway" },
      networkInfo: { vpcId: "vnet-azure01" },
      relationships: [{ targetResourceId: "vnet-azure01", type: "attached-to" }],
    },
  ],
};

const GCP_PROJECT: ProjectSeed = {
  accountName: "project-gcp",
  provider: "gcp",
  accountId: "project-gcp-458217",
  regions: ["us-central1"],
  resources: [
    {
      externalId: "vpc-gcp01", name: "gcp-prod-network", provider: "gcp", region: "us-central1", type: "vpc",
      properties: { cidr: "10.20.0.0/16", state: "READY" },
      tags: { Name: "gcp-prod-network", Environment: "production", Project: "project-gcp" },
      relationships: [],
    },
    {
      externalId: "subnet-gcp-web", name: "gcp-web-subnet", provider: "gcp", region: "us-central1", type: "subnet",
      properties: { cidr: "10.20.1.0/24", public: true },
      tags: { Name: "gcp-web-subnet" },
      networkInfo: { vpcId: "vpc-gcp01" },
      relationships: [{ targetResourceId: "vpc-gcp01", type: "contains" }],
    },
    {
      externalId: "subnet-gcp-data", name: "gcp-data-subnet", provider: "gcp", region: "us-central1", type: "subnet",
      properties: { cidr: "10.20.2.0/24", public: false },
      tags: { Name: "gcp-data-subnet" },
      networkInfo: { vpcId: "vpc-gcp01" },
      relationships: [{ targetResourceId: "vpc-gcp01", type: "contains" }],
    },
    {
      externalId: "fw-gcp01", name: "gcp-web-firewall", provider: "gcp", region: "us-central1", type: "security-group",
      properties: {
        inboundRules: [
          { protocol: "tcp", fromPort: "443", toPort: "443", cidrs: ["0.0.0.0/0"] },
          { protocol: "tcp", fromPort: "22", toPort: "22", cidrs: ["35.235.240.0/20"] },
        ],
        outboundRules: [{ protocol: "-1", fromPort: "", toPort: "", cidrs: ["0.0.0.0/0"] }],
      },
      tags: { Name: "gcp-web-firewall" },
      networkInfo: { vpcId: "vpc-gcp01" },
      relationships: [],
    },
    {
      externalId: "gce-web1", name: "gcp-web-instance-1", provider: "gcp", region: "us-central1", type: "vm",
      properties: { instanceType: "e2-medium", state: "RUNNING" },
      tags: { Name: "gcp-web-instance-1", Environment: "production", Owner: "platform-team" },
      networkInfo: { vpcId: "vpc-gcp01", subnetId: "subnet-gcp-web", privateIps: ["10.20.1.5"], publicIps: ["34.72.11.4"], securityGroups: ["fw-gcp01"] },
      relationships: [{ targetResourceId: "subnet-gcp-web", type: "runs-in" }, { targetResourceId: "fw-gcp01", type: "member-of" }],
    },
    {
      externalId: "gce-app1", name: "gcp-app-instance-1", provider: "gcp", region: "us-central1", type: "vm",
      properties: { instanceType: "e2-standard-4", state: "RUNNING" },
      tags: { Name: "gcp-app-instance-1", Environment: "production", Owner: "platform-team" },
      networkInfo: { vpcId: "vpc-gcp01", subnetId: "subnet-gcp-data", privateIps: ["10.20.2.9"], securityGroups: ["fw-gcp01"] },
      relationships: [{ targetResourceId: "subnet-gcp-data", type: "runs-in" }, { targetResourceId: "fw-gcp01", type: "member-of" }],
    },
    {
      externalId: "gcs-gcp-assets", name: "gcp-prod-assets", provider: "gcp", region: "us-central1", type: "s3-bucket",
      properties: { storageClass: "STANDARD", versioning: "Enabled" },
      tags: { Name: "gcp-prod-assets", Environment: "production" },
      relationships: [],
    },
    {
      externalId: "sql-gcp-prod", name: "gcp-prod-cloudsql", provider: "gcp", region: "us-central1", type: "rds-instance",
      properties: { engine: "postgres", engineVersion: "15", instanceClass: "db-custom-4-16384", multiAz: true, state: "RUNNABLE" },
      tags: { Name: "gcp-prod-cloudsql", Environment: "production" },
      networkInfo: { vpcId: "vpc-gcp01", subnetId: "subnet-gcp-data" },
      relationships: [{ targetResourceId: "subnet-gcp-data", type: "runs-in" }],
    },
    {
      externalId: "fn-gcp-thumbnail", name: "gcp-thumbnail-function", provider: "gcp", region: "us-central1", type: "lambda",
      properties: { runtime: "python312", memorySize: 256, timeout: 60, state: "ACTIVE" },
      tags: { Name: "gcp-thumbnail-function", Environment: "production" },
      relationships: [],
    },
    {
      externalId: "gke-gcp-worker", name: "gcp-gke-worker-pod", provider: "gcp", region: "us-central1", type: "container",
      properties: { image: "gcr.io/project-gcp/worker:1.4.2", state: "Running" },
      tags: { Name: "gcp-gke-worker-pod", Environment: "production" },
      networkInfo: { vpcId: "vpc-gcp01", subnetId: "subnet-gcp-data", privateIps: ["10.20.2.20"] },
      relationships: [{ targetResourceId: "subnet-gcp-data", type: "runs-in" }],
    },
    {
      externalId: "lb-gcp-prod", name: "gcp-prod-lb", provider: "gcp", region: "us-central1", type: "load-balancer",
      properties: { scheme: "EXTERNAL", listeners: "443/HTTPS", healthCheck: "/healthz", connectedServices: "gcp-web-instance-1" },
      tags: { Name: "gcp-prod-lb", Environment: "production" },
      networkInfo: { vpcId: "vpc-gcp01" },
      relationships: [{ targetResourceId: "gce-web1", type: "targets" }],
    },
  ],
};

const PROJECTS: ProjectSeed[] = [AWS_PROJECT, AZURE_PROJECT, GCP_PROJECT];

export interface SeedDemoInfraResult {
  createdAccounts: string[];
  skippedAccounts: string[];
  totalResourcesCreated: number;
}

export function seedDemoInfra(createdBy: string): SeedDemoInfraResult {
  const createdAccounts: string[] = [];
  const skippedAccounts: string[] = [];
  let totalResourcesCreated = 0;

  for (const project of PROJECTS) {
    const existing = listInfraAccounts().find((a) => a.name === project.accountName);
    if (existing) {
      skippedAccounts.push(project.accountName);
      continue;
    }

    const account = createInfraAccount({
      name: project.accountName,
      provider: project.provider,
      accountId: project.accountId,
      regions: project.regions,
      accessMode: "agent",
      agentIds: [],
      enabled: true,
      createdBy,
    });

    const { created } = upsertInfraResources(account.id, project.resources);
    totalResourcesCreated += created;
    createdAccounts.push(project.accountName);
  }

  return { createdAccounts, skippedAccounts, totalResourcesCreated };
}
