/**
 * Real cloud-provider architecture icons — AWS/Azure icons from the
 * providers' own official icon sets (via `aws-react-icons` and
 * `@threeveloper/azure-react-icons`, both MIT-licensed React wrappers
 * around the official AWS/Azure Architecture Icons, the same assets
 * draw.io ships), GCP icons via Iconify's `gcp` collection (Apache-2.0,
 * Google's own open-sourced Cloud icon set).
 *
 * Deliberately a curated subset, not full coverage — only the resource
 * types this app actually models (see `infraDiscovery.ts`'s
 * `InfraResourceType`). Anything not mapped here falls back to the plain
 * emoji already carried in `data.icon`, so coverage gaps degrade
 * gracefully instead of rendering nothing.
 *
 * Author: Yogesh Tiwari
 */

import { Icon, addCollection } from "@iconify/react";
import gcpIconSet from "@iconify-json/gcp/icons.json";

// Icon components live in aws-react-icons's per-file CJS modules
// (`module.exports = function(){...}`, no named export to import
// directly) — the package's top-level ESM entry re-exports each one as a
// proper named export, so we import from there instead of the deep paths.
import {
  ArchitectureServiceAmazonEC2,
  ArchitectureServiceAWSLambda,
  ArchitectureServiceAmazonElasticContainerService,
  ArchitectureServiceAmazonRDS,
  ArchitectureServiceAmazonSimpleStorageService,
  ArchitectureServiceElasticLoadBalancing,
  ResourceAmazonVPCVirtualprivatecloudVPC,
  ResourceAmazonVPCInternetGateway,
  ResourceAmazonVPCNATGateway,
  ArchitectureServiceAmazonDynamoDB,
  ArchitectureServiceAmazonSimpleQueueService,
  ArchitectureServiceAmazonCloudFront,
  ArchitectureGroupPrivatesubnet,
} from "aws-react-icons";

import { VirtualMachine as AzureVirtualMachine } from "@threeveloper/azure-react-icons/dist/components/compute/10021-icon-service-Virtual-Machine";
import { FunctionApps as AzureFunctionApps } from "@threeveloper/azure-react-icons/dist/components/compute/10029-icon-service-Function-Apps";
import { ContainerInstances as AzureContainerInstances } from "@threeveloper/azure-react-icons/dist/components/compute/10104-icon-service-Container-Instances";
import { SQLDatabase as AzureSQLDatabase } from "@threeveloper/azure-react-icons/dist/components/databases/10130-icon-service-SQL-Database";
import { StorageAccounts as AzureStorageAccounts } from "@threeveloper/azure-react-icons/dist/components/storage/10086-icon-service-Storage-Accounts";
import { LoadBalancers as AzureLoadBalancers } from "@threeveloper/azure-react-icons/dist/components/networking/10062-icon-service-Load-Balancers";
import { NetworkSecurityGroups as AzureNetworkSecurityGroups } from "@threeveloper/azure-react-icons/dist/components/networking/10067-icon-service-Network-Security-Groups";
import { PublicIPAddresses as AzurePublicIPAddresses } from "@threeveloper/azure-react-icons/dist/components/networking/10069-icon-service-Public-IP-Addresses";
import { VirtualNetworks as AzureVirtualNetworks } from "@threeveloper/azure-react-icons/dist/components/networking/10061-icon-service-Virtual-Networks";
import { Subnet as AzureSubnet } from "@threeveloper/azure-react-icons/dist/components/networking/02742-icon-service-Subnet";
import { StorageQueue as AzureStorageQueue } from "@threeveloper/azure-react-icons/dist/components/general/10840-icon-service-Storage-Queue";
import { CDNProfiles as AzureCDNProfiles } from "@threeveloper/azure-react-icons/dist/components/networking/00056-icon-service-CDN-Profiles";

addCollection(gcpIconSet);

type IconComponent = (props: { size?: string | number; className?: string }) => JSX.Element;

// AWS icons already bake in the official per-service square color swatch
// (e.g. EC2's orange square) — rendered edge-to-edge in the badge, not
// composited over our own accent color.
const AWS_ICONS: Partial<Record<string, IconComponent>> = {
  vm: ArchitectureServiceAmazonEC2,
  lambda: ArchitectureServiceAWSLambda,
  container: ArchitectureServiceAmazonElasticContainerService,
  "ecs-task": ArchitectureServiceAmazonElasticContainerService,
  "rds-instance": ArchitectureServiceAmazonRDS,
  "rds-cluster": ArchitectureServiceAmazonRDS,
  "s3-bucket": ArchitectureServiceAmazonSimpleStorageService,
  "load-balancer": ArchitectureServiceElasticLoadBalancing,
  vpc: ResourceAmazonVPCVirtualprivatecloudVPC,
  "internet-gateway": ResourceAmazonVPCInternetGateway,
  "nat-gateway": ResourceAmazonVPCNATGateway,
  "dynamodb-table": ArchitectureServiceAmazonDynamoDB,
  queue: ArchitectureServiceAmazonSimpleQueueService,
  cdn: ArchitectureServiceAmazonCloudFront,
  subnet: ArchitectureGroupPrivatesubnet,
};

// Azure/GCP icons are drawn on a transparent background (their own brand
// colors/gradients, no baked-in square) — composited over our existing
// per-type accent color badge instead.
const AZURE_ICONS: Partial<Record<string, IconComponent>> = {
  vm: AzureVirtualMachine,
  lambda: AzureFunctionApps,
  container: AzureContainerInstances,
  "rds-instance": AzureSQLDatabase,
  "rds-cluster": AzureSQLDatabase,
  "storage-account": AzureStorageAccounts,
  "load-balancer": AzureLoadBalancers,
  "security-group": AzureNetworkSecurityGroups,
  "internet-gateway": AzurePublicIPAddresses,
  vpc: AzureVirtualNetworks,
  subnet: AzureSubnet,
  queue: AzureStorageQueue,
  cdn: AzureCDNProfiles,
};

const GCP_ICONS: Partial<Record<string, string>> = {
  vm: "compute-engine",
  lambda: "cloud-functions",
  "s3-bucket": "cloud-storage",
  "rds-instance": "cloud-sql",
  "rds-cluster": "cloud-sql",
  "load-balancer": "cloud-load-balancing",
  "security-group": "cloud-firewall-rules",
  "nat-gateway": "cloud-nat",
  "internet-gateway": "cloud-external-ip-addresses",
  vpc: "cloud-network",
  container: "google-kubernetes-engine",
  "kubernetes-pod": "google-kubernetes-engine",
  cdn: "cloud-cdn",
  queue: "pubsub",
};

interface CloudIconProps {
  provider?: string;
  resourceType?: string;
  fallbackEmoji: string;
  accent: string;
  size: number;
}

/** Full badge (background + icon) — replaces the plain emoji badge whenever a real icon exists for this provider/type combo. */
export function CloudIcon({ provider, resourceType, fallbackEmoji, accent, size }: CloudIconProps) {
  if (provider === "aws" && resourceType) {
    const AwsIcon = AWS_ICONS[resourceType];
    if (AwsIcon) {
      return (
        <div className="cloud-icon-badge" style={{ width: size, height: size }}>
          <AwsIcon size={size} />
        </div>
      );
    }
  }
  if (provider === "azure" && resourceType) {
    const AzureIcon = AZURE_ICONS[resourceType];
    if (AzureIcon) {
      return (
        <div className="cloud-icon-badge" style={{ width: size, height: size, background: accent }}>
          <AzureIcon size={Math.round(size * 0.62)} />
        </div>
      );
    }
  }
  if (provider === "gcp" && resourceType) {
    const gcpIconName = GCP_ICONS[resourceType];
    if (gcpIconName) {
      return (
        <div className="cloud-icon-badge" style={{ width: size, height: size, background: accent }}>
          <Icon icon={`gcp:${gcpIconName}`} width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} />
        </div>
      );
    }
  }
  return (
    <div className="cloud-icon-badge" style={{ width: size, height: size, background: accent }}>
      <span className="cloud-icon-emoji">{fallbackEmoji}</span>
    </div>
  );
}
