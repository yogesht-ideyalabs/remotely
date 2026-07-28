/**
 * Shape palette — draggable icon library for the diagram editor.
 * Organized by provider (AWS, Azure, GCP, VMware, Network, Generic).
 *
 * Author: Yogesh Tiwari
 */

import { useEffect, useState, type ChangeEvent, type DragEvent, useMemo } from "react";
import { Icon } from "../../Icon";

export interface ShapeDefinition {
  id: string;
  label: string;
  icon: string;
  provider: string;
  resourceType: string;
  color?: string;
  isGroup?: boolean;
  // A user-uploaded SVG/PNG data URI, rendered instead of `icon`/CloudIcon's
  // provider lookup when present (see InfraNode.tsx). Custom shapes are
  // deliberately kept in localStorage rather than persisted server-side —
  // a personal shape library, not shared team infrastructure, so no
  // control-plane/schema change needed for this one.
  customImage?: string;
}

const CUSTOM_SHAPES_STORAGE_KEY = "remotely_custom_shapes";

function loadCustomShapes(): ShapeDefinition[] {
  try {
    const raw = localStorage.getItem(CUSTOM_SHAPES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomShapes(shapes: ShapeDefinition[]) {
  localStorage.setItem(CUSTOM_SHAPES_STORAGE_KEY, JSON.stringify(shapes));
}

interface ShapeCategory {
  name: string;
  icon: string;
  shapes: ShapeDefinition[];
}

const SHAPE_CATEGORIES: ShapeCategory[] = [
  {
    name: "AWS",
    icon: "cloud",
    shapes: [
      { id: "aws-ec2", label: "EC2 Instance", icon: "resources", provider: "aws", resourceType: "vm", color: "#f97316" },
      { id: "aws-lambda", label: "Lambda", icon: "lambda", provider: "aws", resourceType: "lambda", color: "#eab308" },
      { id: "aws-rds", label: "RDS Database", icon: "db", provider: "aws", resourceType: "rds-instance", color: "#3b82f6" },
      { id: "aws-s3", label: "S3 Bucket", icon: "bucket", provider: "aws", resourceType: "s3-bucket", color: "#22c55e" },
      { id: "aws-elb", label: "Load Balancer", icon: "scale", provider: "aws", resourceType: "load-balancer", color: "#06b6d4" },
      { id: "aws-vpc", label: "VPC", icon: "cloud", provider: "aws", resourceType: "vpc", color: "#5b8cff", isGroup: true },
      { id: "aws-subnet", label: "Subnet", icon: "net", provider: "aws", resourceType: "subnet", color: "#64748b", isGroup: true },
      { id: "aws-igw", label: "Internet Gateway", icon: "share", provider: "aws", resourceType: "internet-gateway", color: "#10b981" },
      { id: "aws-nat", label: "NAT Gateway", icon: "share", provider: "aws", resourceType: "nat-gateway", color: "#f59e0b" },
      { id: "aws-sg", label: "Security Group", icon: "shield", provider: "aws", resourceType: "security-group", color: "#ef4444" },
      { id: "aws-ecs", label: "ECS / Fargate", icon: "layers", provider: "aws", resourceType: "ecs-task", color: "#8b5cf6" },
      { id: "aws-eks", label: "EKS Cluster", icon: "layers", provider: "aws", resourceType: "kubernetes-pod", color: "#3b82f6" },
      { id: "aws-dynamodb", label: "DynamoDB", icon: "db", provider: "aws", resourceType: "dynamodb-table", color: "#3b82f6" },
      { id: "aws-elasticache", label: "ElastiCache", icon: "db", provider: "aws", resourceType: "elasticache", color: "#ef4444" },
      { id: "aws-sqs", label: "SQS Queue", icon: "list", provider: "aws", resourceType: "queue", color: "#f97316" },
      { id: "aws-sns", label: "SNS Topic", icon: "share", provider: "aws", resourceType: "topic", color: "#a855f7" },
      { id: "aws-cloudfront", label: "CloudFront", icon: "cloud", provider: "aws", resourceType: "cdn", color: "#6366f1" },
      { id: "aws-apigw", label: "API Gateway", icon: "plug", provider: "aws", resourceType: "api-gateway", color: "#ec4899" },
      { id: "aws-route53", label: "Route 53", icon: "net", provider: "aws", resourceType: "dns-zone", color: "#8b5cf6" },
    ],
  },
  {
    name: "Azure",
    icon: "cloud",
    shapes: [
      { id: "az-vm", label: "Virtual Machine", icon: "resources", provider: "azure", resourceType: "vm", color: "#0ea5e9" },
      { id: "az-app-svc", label: "App Service", icon: "layers", provider: "azure", resourceType: "container", color: "#0ea5e9" },
      { id: "az-sql", label: "Azure SQL", icon: "db", provider: "azure", resourceType: "rds-instance", color: "#0ea5e9" },
      { id: "az-blob", label: "Blob Storage", icon: "bucket", provider: "azure", resourceType: "s3-bucket", color: "#0ea5e9" },
      { id: "az-lb", label: "Load Balancer", icon: "scale", provider: "azure", resourceType: "load-balancer", color: "#0ea5e9" },
      { id: "az-vnet", label: "VNet", icon: "cloud", provider: "azure", resourceType: "vpc", color: "#0ea5e9", isGroup: true },
      { id: "az-subnet", label: "Subnet", icon: "net", provider: "azure", resourceType: "subnet", color: "#64748b", isGroup: true },
      { id: "az-nsg", label: "NSG", icon: "shield", provider: "azure", resourceType: "security-group", color: "#ef4444" },
      { id: "az-func", label: "Azure Functions", icon: "lambda", provider: "azure", resourceType: "lambda", color: "#eab308" },
      { id: "az-aks", label: "AKS Cluster", icon: "layers", provider: "azure", resourceType: "kubernetes-pod", color: "#3b82f6" },
    ],
  },
  {
    name: "GCP",
    icon: "cloud",
    shapes: [
      { id: "gcp-gce", label: "Compute Engine", icon: "resources", provider: "gcp", resourceType: "vm", color: "#ea4335" },
      { id: "gcp-cloud-run", label: "Cloud Run", icon: "layers", provider: "gcp", resourceType: "container", color: "#4285f4" },
      { id: "gcp-sql", label: "Cloud SQL", icon: "db", provider: "gcp", resourceType: "rds-instance", color: "#4285f4" },
      { id: "gcp-gcs", label: "Cloud Storage", icon: "bucket", provider: "gcp", resourceType: "s3-bucket", color: "#34a853" },
      { id: "gcp-lb", label: "Load Balancer", icon: "scale", provider: "gcp", resourceType: "load-balancer", color: "#4285f4" },
      { id: "gcp-vpc", label: "VPC Network", icon: "cloud", provider: "gcp", resourceType: "vpc", color: "#4285f4", isGroup: true },
      { id: "gcp-subnet", label: "Subnet", icon: "net", provider: "gcp", resourceType: "subnet", color: "#64748b", isGroup: true },
      { id: "gcp-func", label: "Cloud Functions", icon: "lambda", provider: "gcp", resourceType: "lambda", color: "#fbbc04" },
      { id: "gcp-gke", label: "GKE Cluster", icon: "layers", provider: "gcp", resourceType: "kubernetes-pod", color: "#4285f4" },
    ],
  },
  {
    name: "VMware",
    icon: "resources",
    shapes: [
      { id: "vm-esxi", label: "ESXi Host", icon: "resources", provider: "vmware", resourceType: "esxi-host", color: "#78be20" },
      { id: "vm-vm", label: "Virtual Machine", icon: "resources", provider: "vmware", resourceType: "vm", color: "#78be20" },
      { id: "vm-ds", label: "Datastore", icon: "db", provider: "vmware", resourceType: "datastore", color: "#78be20" },
      { id: "vm-vswitch", label: "vSwitch", icon: "net", provider: "vmware", resourceType: "vswitch", color: "#78be20" },
    ],
  },
  {
    name: "Proxmox",
    icon: "layers",
    shapes: [
      { id: "pve-node", label: "Proxmox Node", icon: "resources", provider: "proxmox", resourceType: "proxmox-node", color: "#e57000" },
      { id: "pve-vm", label: "VM (QEMU)", icon: "resources", provider: "proxmox", resourceType: "proxmox-vm", color: "#e57000" },
      { id: "pve-ct", label: "Container (LXC)", icon: "layers", provider: "proxmox", resourceType: "proxmox-container", color: "#e57000" },
    ],
  },
  {
    name: "Network",
    icon: "net",
    shapes: [
      { id: "net-router", label: "Router", icon: "net", provider: "network", resourceType: "other", color: "#6366f1" },
      { id: "net-switch", label: "Switch", icon: "net", provider: "network", resourceType: "other", color: "#6366f1" },
      { id: "net-firewall", label: "Firewall", icon: "shield", provider: "network", resourceType: "other", color: "#ef4444" },
      { id: "net-vpn", label: "VPN Gateway", icon: "shield", provider: "network", resourceType: "vpn-gateway", color: "#8b5cf6" },
      { id: "net-dns", label: "DNS Server", icon: "net", provider: "network", resourceType: "dns-zone", color: "#06b6d4" },
      { id: "net-internet", label: "Internet", icon: "cloud", provider: "network", resourceType: "other", color: "#10b981" },
    ],
  },
  {
    name: "Generic",
    icon: "grid",
    shapes: [
      { id: "gen-server", label: "Server", icon: "resources", provider: "generic", resourceType: "vm", color: "#64748b" },
      { id: "gen-database", label: "Database", icon: "db", provider: "generic", resourceType: "other", color: "#3b82f6" },
      { id: "gen-storage", label: "Storage", icon: "bucket", provider: "generic", resourceType: "other", color: "#22c55e" },
      { id: "gen-user", label: "User / Client", icon: "users", provider: "generic", resourceType: "other", color: "#f97316" },
      { id: "gen-service", label: "Service", icon: "gear", provider: "generic", resourceType: "other", color: "#8b5cf6" },
      { id: "gen-container", label: "Container", icon: "layers", provider: "generic", resourceType: "container", color: "#0ea5e9" },
      { id: "gen-region", label: "Region", icon: "map", provider: "generic", resourceType: "other", color: "#5b8cff", isGroup: true },
      { id: "gen-az", label: "Availability Zone", icon: "building", provider: "generic", resourceType: "other", color: "#64748b", isGroup: true },
      { id: "gen-cluster", label: "Cluster", icon: "grid", provider: "generic", resourceType: "other", color: "#a855f7", isGroup: true },
      { id: "gen-text", label: "Text Annotation", icon: "pen", provider: "generic", resourceType: "other", color: "#94a3b8" },
    ],
  },
];

export function ShapePalette() {
  const [expandedCategory, setExpandedCategory] = useState<string>("AWS");
  const [search, setSearch] = useState("");
  const [customShapes, setCustomShapes] = useState<ShapeDefinition[]>(() => loadCustomShapes());
  const [uploadLabel, setUploadLabel] = useState("");
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    saveCustomShapes(customShapes);
  }, [customShapes]);

  const onDragStart = (event: DragEvent, shape: ShapeDefinition) => {
    event.dataTransfer.setData("application/reactflow", JSON.stringify(shape));
    event.dataTransfer.effectAllowed = "move";
  };

  const onUploadFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(svg\+xml|png|jpeg)$/.test(file.type)) {
      setUploadError("Only SVG, PNG, or JPEG images are supported.");
      return;
    }
    if (file.size > 500_000) {
      setUploadError("Image too large — keep custom shapes under 500KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const shape: ShapeDefinition = {
        id: `custom-${Date.now()}`,
        label: uploadLabel.trim() || file.name.replace(/\.[a-z]+$/i, ""),
        icon: "copy",
        provider: "custom",
        resourceType: "other",
        color: "#8a94a8",
        customImage: reader.result as string,
      };
      setCustomShapes((prev) => [...prev, shape]);
      setUploadLabel("");
      setUploadError("");
    };
    reader.onerror = () => setUploadError("Couldn't read that file.");
    reader.readAsDataURL(file);
  };

  const deleteCustomShape = (id: string) => {
    setCustomShapes((prev) => prev.filter((s) => s.id !== id));
  };

  const allCategories = useMemo(
    () => (customShapes.length > 0 ? [...SHAPE_CATEGORIES, { name: "Custom", icon: "puzzle", shapes: customShapes }] : SHAPE_CATEGORIES),
    [customShapes]
  );

  const filteredCategories = useMemo(() => {
    if (!search) return allCategories;
    const q = search.toLowerCase();
    return allCategories.map((cat) => ({
      ...cat,
      shapes: cat.shapes.filter(
        (s) =>
          s.label.toLowerCase().includes(q) ||
          s.resourceType.toLowerCase().includes(q) ||
          s.provider.toLowerCase().includes(q)
      ),
    })).filter((cat) => cat.shapes.length > 0);
  }, [search, allCategories]);

  return (
    <div className="shape-palette">
      <div className="palette-search">
        <input
          type="text"
          placeholder="Search shapes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="palette-categories">
        {filteredCategories.map((cat) => (
          <div key={cat.name} className="palette-category">
            <button
              className={`category-header ${expandedCategory === cat.name ? "expanded" : ""}`}
              onClick={() => setExpandedCategory(expandedCategory === cat.name ? "" : cat.name)}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name={cat.icon} size={14} /> {cat.name}
              </span>
              <span className="category-count">{cat.shapes.length}</span>
            </button>

            {(expandedCategory === cat.name || search) && (
              <div className="category-shapes">
                {cat.shapes.map((shape) => (
                  <div
                    key={shape.id}
                    className="shape-item"
                    draggable
                    onDragStart={(e) => onDragStart(e, shape)}
                    title={shape.label}
                  >
                    {shape.customImage ? (
                      <img className="shape-icon shape-icon-custom" src={shape.customImage} alt="" />
                    ) : (
                      <span className="shape-swatch" style={{ background: shape.color }}>
                        <Icon name={shape.icon} size={13} style={{ stroke: "#fff" }} />
                      </span>
                    )}
                    <span className="shape-label">{shape.label}</span>
                    {shape.isGroup && <span className="shape-badge">group</span>}
                    {shape.provider === "custom" && (
                      <button
                        className="shape-delete"
                        title="Remove custom shape"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteCustomShape(shape.id);
                        }}
                      >
                        <Icon name="x-circle" size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="palette-upload">
        <p className="palette-upload-label">Custom shape</p>
        {uploadError && <p className="palette-upload-error">{uploadError}</p>}
        <input
          type="text"
          placeholder="Label (optional)"
          value={uploadLabel}
          onChange={(e) => setUploadLabel(e.target.value)}
        />
        <label className="palette-upload-btn">
          <Icon name="upload" size={13} /> Upload SVG/PNG
          <input type="file" accept="image/svg+xml,image/png,image/jpeg" onChange={onUploadFile} hidden />
        </label>
      </div>
    </div>
  );
}
