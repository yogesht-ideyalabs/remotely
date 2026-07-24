/**
 * Node Properties Panel — right sidebar for configuring a selected node.
 *
 * When you click any shape on the canvas, this panel opens showing:
 * - Name / label
 * - Resource type
 * - Provider
 * - Configurable properties (varies by type):
 *   - Load Balancer: connected services, scheme, listeners, health checks
 *   - EC2/VM: instance type, AMI, state, IPs
 *   - RDS: engine, version, instance class, multi-AZ
 *   - VPC/Subnet: CIDR, AZ, public/private
 *   - Security Group: inbound/outbound rules
 *   - Generic: custom key-value properties
 * - Connected to (list of edges)
 * - Tags / labels
 * - Notes / description
 *
 * Author: Yogesh Tiwari
 */

import { useState } from "react";
import type { Node } from "@xyflow/react";

interface NodePropertiesPanelProps {
  node: Node;
  allNodes: Node[];
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  onClose: () => void;
}

interface NodeData {
  label?: string;
  icon?: string;
  provider?: string;
  resourceType?: string;
  color?: string;
  // Configurable properties
  description?: string;
  instanceType?: string;
  state?: string;
  cidr?: string;
  scheme?: string;
  engine?: string;
  engineVersion?: string;
  multiAz?: boolean;
  listeners?: string;
  healthCheck?: string;
  connectedServices?: string;
  securityRules?: string;
  ipAddress?: string;
  dnsName?: string;
  port?: string;
  protocol?: string;
  tags?: Record<string, string>;
  notes?: string;
  [key: string]: unknown;
}

export function NodePropertiesPanel({ node, allNodes, onUpdate, onClose }: NodePropertiesPanelProps) {
  const data = node.data as NodeData;
  const [localData, setLocalData] = useState<NodeData>({ ...data });

  const updateField = (field: string, value: unknown) => {
    const updated = { ...localData, [field]: value };
    setLocalData(updated);
    onUpdate(node.id, { [field]: value });
  };

  const resourceType = localData.resourceType || "other";

  return (
    <div className="node-properties-panel">
      <div className="props-header">
        <div className="props-title">
          <span className="props-icon">{localData.icon || "📦"}</span>
          <span>Properties</span>
        </div>
        <button className="props-close" onClick={onClose}>✕</button>
      </div>

      <div className="props-body">
        {/* Basic Info */}
        <div className="props-section">
          <h4>General</h4>
          <label>
            <span>Name</span>
            <input
              value={localData.label || ""}
              onChange={(e) => updateField("label", e.target.value)}
              placeholder="Resource name"
            />
          </label>
          <label>
            <span>Description</span>
            <textarea
              value={localData.description || ""}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder="What does this resource do?"
              rows={2}
            />
          </label>
          <label>
            <span>Provider</span>
            <select value={localData.provider || ""} onChange={(e) => updateField("provider", e.target.value)}>
              <option value="aws">AWS</option>
              <option value="azure">Azure</option>
              <option value="gcp">GCP</option>
              <option value="vmware">VMware</option>
              <option value="proxmox">Proxmox</option>
              <option value="network">Network</option>
              <option value="generic">Generic</option>
            </select>
          </label>
          <div className="props-meta">
            <span>Type: {resourceType}</span>
            <span>ID: {node.id.slice(0, 16)}...</span>
          </div>
        </div>

        {/* Type-specific properties */}
        {(resourceType === "load-balancer") && (
          <div className="props-section">
            <h4>Load Balancer Config</h4>
            <label>
              <span>Scheme</span>
              <select value={localData.scheme || ""} onChange={(e) => updateField("scheme", e.target.value)}>
                <option value="">Select...</option>
                <option value="internet-facing">Internet-facing</option>
                <option value="internal">Internal</option>
              </select>
            </label>
            <label>
              <span>Listeners (ports)</span>
              <input
                value={localData.listeners || ""}
                onChange={(e) => updateField("listeners", e.target.value)}
                placeholder="e.g., HTTP:80, HTTPS:443"
              />
            </label>
            <label>
              <span>Connected Services / Targets</span>
              <textarea
                value={localData.connectedServices || ""}
                onChange={(e) => updateField("connectedServices", e.target.value)}
                placeholder="List backend services or target groups..."
                rows={3}
              />
            </label>
            <label>
              <span>Health Check</span>
              <input
                value={localData.healthCheck || ""}
                onChange={(e) => updateField("healthCheck", e.target.value)}
                placeholder="e.g., HTTP /health, interval 30s"
              />
            </label>
            <label>
              <span>DNS Name</span>
              <input
                value={localData.dnsName || ""}
                onChange={(e) => updateField("dnsName", e.target.value)}
                placeholder="alb-xyz.us-east-1.elb.amazonaws.com"
              />
            </label>
          </div>
        )}

        {(resourceType === "vm" || resourceType === "container") && (
          <div className="props-section">
            <h4>Compute Config</h4>
            <label>
              <span>Instance Type / Size</span>
              <input
                value={localData.instanceType || ""}
                onChange={(e) => updateField("instanceType", e.target.value)}
                placeholder="e.g., t3.medium, Standard_B2s"
              />
            </label>
            <label>
              <span>State</span>
              <select value={localData.state || ""} onChange={(e) => updateField("state", e.target.value)}>
                <option value="">Select...</option>
                <option value="running">Running</option>
                <option value="stopped">Stopped</option>
                <option value="terminated">Terminated</option>
              </select>
            </label>
            <label>
              <span>IP Address</span>
              <input
                value={localData.ipAddress || ""}
                onChange={(e) => updateField("ipAddress", e.target.value)}
                placeholder="10.0.1.50"
              />
            </label>
            <label>
              <span>Security Groups</span>
              <input
                value={localData.securityRules || ""}
                onChange={(e) => updateField("securityRules", e.target.value)}
                placeholder="sg-web, sg-app"
              />
            </label>
          </div>
        )}

        {(resourceType === "rds-instance" || resourceType === "rds-cluster") && (
          <div className="props-section">
            <h4>Database Config</h4>
            <label>
              <span>Engine</span>
              <select value={localData.engine || ""} onChange={(e) => updateField("engine", e.target.value)}>
                <option value="">Select...</option>
                <option value="mysql">MySQL</option>
                <option value="postgres">PostgreSQL</option>
                <option value="aurora-mysql">Aurora MySQL</option>
                <option value="aurora-postgresql">Aurora PostgreSQL</option>
                <option value="sqlserver">SQL Server</option>
                <option value="mariadb">MariaDB</option>
              </select>
            </label>
            <label>
              <span>Instance Class</span>
              <input
                value={localData.instanceType || ""}
                onChange={(e) => updateField("instanceType", e.target.value)}
                placeholder="e.g., db.r5.large"
              />
            </label>
            <label>
              <span>Multi-AZ</span>
              <select value={localData.multiAz ? "true" : "false"} onChange={(e) => updateField("multiAz", e.target.value === "true")}>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </label>
            <label>
              <span>Endpoint</span>
              <input
                value={localData.dnsName || ""}
                onChange={(e) => updateField("dnsName", e.target.value)}
                placeholder="mydb.cluster-xyz.us-east-1.rds.amazonaws.com"
              />
            </label>
          </div>
        )}

        {(resourceType === "vpc" || resourceType === "subnet") && (
          <div className="props-section">
            <h4>Network Config</h4>
            <label>
              <span>CIDR Block</span>
              <input
                value={localData.cidr || ""}
                onChange={(e) => updateField("cidr", e.target.value)}
                placeholder="e.g., 10.0.0.0/16"
              />
            </label>
            {resourceType === "subnet" && (
              <label>
                <span>Availability Zone</span>
                <input
                  value={(localData as Record<string,unknown>).az as string || ""}
                  onChange={(e) => updateField("az", e.target.value)}
                  placeholder="e.g., us-east-1a"
                />
              </label>
            )}
          </div>
        )}

        {resourceType === "security-group" && (
          <div className="props-section">
            <h4>Security Rules</h4>
            <label>
              <span>Inbound Rules</span>
              <textarea
                value={localData.securityRules || ""}
                onChange={(e) => updateField("securityRules", e.target.value)}
                placeholder="e.g., TCP 443 from 0.0.0.0/0&#10;TCP 80 from 10.0.0.0/8"
                rows={4}
              />
            </label>
          </div>
        )}

        {(resourceType === "lambda") && (
          <div className="props-section">
            <h4>Function Config</h4>
            <label>
              <span>Runtime</span>
              <input
                value={(localData as Record<string,unknown>).runtime as string || ""}
                onChange={(e) => updateField("runtime", e.target.value)}
                placeholder="e.g., nodejs20.x, python3.12"
              />
            </label>
            <label>
              <span>Memory (MB)</span>
              <input
                type="number"
                value={(localData as Record<string,unknown>).memory as string || ""}
                onChange={(e) => updateField("memory", e.target.value)}
                placeholder="128"
              />
            </label>
            <label>
              <span>Timeout (sec)</span>
              <input
                type="number"
                value={(localData as Record<string,unknown>).timeout as string || ""}
                onChange={(e) => updateField("timeout", e.target.value)}
                placeholder="30"
              />
            </label>
          </div>
        )}

        {/* Networking — applies to most types */}
        <div className="props-section">
          <h4>Networking</h4>
          <label>
            <span>Protocol / Port</span>
            <input
              value={localData.port || ""}
              onChange={(e) => updateField("port", e.target.value)}
              placeholder="e.g., HTTPS:443, gRPC:50051"
            />
          </label>
          <label>
            <span>Connected To</span>
            <textarea
              value={localData.connectedServices || ""}
              onChange={(e) => updateField("connectedServices", e.target.value)}
              placeholder="List services this connects to..."
              rows={2}
            />
          </label>
        </div>

        {/* Notes */}
        <div className="props-section">
          <h4>Notes</h4>
          <textarea
            className="props-notes"
            value={localData.notes || ""}
            onChange={(e) => updateField("notes", e.target.value)}
            placeholder="Any additional notes about this resource..."
            rows={3}
          />
        </div>
      </div>
    </div>
  );
}
