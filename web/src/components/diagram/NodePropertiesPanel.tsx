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

import { useEffect, useState } from "react";
import type { Node, Edge } from "@xyflow/react";
import { apiFetch, fetchConnections, fetchConnectionAccessSummary, type Connection, type ConnectionAccessSummary } from "../../api";
import { StatusBadge } from "../StatusBadge";

interface NodePropertiesPanelProps {
  node: Node;
  allNodes: Node[];
  edges: Edge[];
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  onClose: () => void;
  // Unlike every other field in this panel, linking/unlinking a Connection
  // is a real backend mutation (control-plane persists it on the
  // InfraResource, not the diagram's own nodes/edges) rather than a local
  // edit that only takes effect on the next "Save" — so the parent needs
  // to know to reload the diagram after it happens. Optional since only
  // Architecture.tsx (live, discovery-backed) wires this up meaningfully.
  onResourceLinked?: () => void;
}

interface SecurityGroupRule {
  protocol: string;
  fromPort: string;
  toPort: string;
  cidrs: string[];
}

interface NetworkInfo {
  vpcId?: string;
  subnetId?: string;
  privateIps?: string[];
  publicIps?: string[];
  securityGroups?: string[];
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
  // Discovery-sourced fields (set by DiagramEditor.tsx's resourceToNodeData
  // / control-plane's autoDiagram.ts — real data from the resource, not
  // manually typed by whoever's editing the diagram)
  region?: string;
  accountId?: string;
  accountName?: string;
  networkInfo?: NetworkInfo;
  inboundRules?: SecurityGroupRule[];
  outboundRules?: SecurityGroupRule[];
  // The underlying InfraResource's own id (distinct from node.id, which is
  // derived from the provider's externalId — see autoDiagram.ts's
  // nodeIdFor) — only present on discovery-sourced nodes, which is what
  // the access-aware-diagram "link to a Connection" feature attaches to.
  resourceId?: string;
  linkedConnectionId?: string;
  [key: string]: unknown;
}

function formatRule(rule: SecurityGroupRule): string {
  const ports = rule.fromPort && rule.toPort ? (rule.fromPort === rule.toPort ? rule.fromPort : `${rule.fromPort}-${rule.toPort}`) : "all";
  const proto = rule.protocol === "-1" ? "all" : rule.protocol;
  const sources = rule.cidrs.length > 0 ? rule.cidrs.join(", ") : "—";
  return `${proto} : ${ports}  (${sources})`;
}

const APPEARANCE_PRESETS = ["#5b8cff", "#f97316", "#8b5cf6", "#22c55e", "#eab308", "#06b6d4", "#ef4444", "#64748b"];

export function NodePropertiesPanel({ node, allNodes, edges, onUpdate, onClose, onResourceLinked }: NodePropertiesPanelProps) {
  const data = node.data as NodeData;
  const [localData, setLocalData] = useState<NodeData>({ ...data });

  const updateField = (field: string, value: unknown) => {
    const updated = { ...localData, [field]: value };
    setLocalData(updated);
    onUpdate(node.id, { [field]: value });
  };

  const resourceType = localData.resourceType || "other";

  // Real graph connections (from actual canvas edges), not the free-text
  // "Connected To" field further down — that's a manual note, this is
  // derived from what's actually drawn on the diagram.
  const connections = edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => {
      const outgoing = e.source === node.id;
      const otherId = outgoing ? e.target : e.source;
      const other = allNodes.find((n) => n.id === otherId);
      const otherLabel = (other?.data as NodeData | undefined)?.label || otherId;
      return { edgeId: e.id, outgoing, otherLabel, edgeLabel: (e.data as { label?: string } | undefined)?.label || "" };
    });

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
        {/* Shape fill color — the same "Style" concern draw.io/Lucidchart
            surface for any selected shape, independent of its resource
            type or discovery-sourced data. */}
        <div className="props-section">
          <h4>Appearance</h4>
          <div className="props-color-swatches">
            {APPEARANCE_PRESETS.map((c) => (
              <button
                key={c}
                className={`props-color-swatch${localData.color === c ? " active" : ""}`}
                style={{ background: c }}
                onClick={() => updateField("color", c)}
                title={c}
              />
            ))}
            <input
              type="color"
              className="props-color-custom"
              value={localData.color || "#5b8cff"}
              onChange={(e) => updateField("color", e.target.value)}
              title="Custom color"
            />
          </div>
        </div>

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
            {localData.region && <span>Region: {localData.region}</span>}
            {localData.accountName && <span>Account: {localData.accountName}</span>}
          </div>
        </div>

        {/* Access-aware diagrams — links this discovered resource to a real
            RBAC-protected Connection so real access data can be shown.
            Infra discovery and Connections are otherwise unrelated systems
            (see linkedConnectionId's doc comment in infraDiscovery.ts) —
            only resources that actually came from discovery have a
            resourceId to link against; a manually-drawn shape has nothing
            to attach real access data to. */}
        {localData.resourceId && (
          <AccessSection
            resourceId={localData.resourceId}
            linkedConnectionId={localData.linkedConnectionId}
            onChanged={onResourceLinked}
          />
        )}

        {/* Real connections, derived from edges actually drawn on the canvas */}
        <div className="props-section">
          <h4>Connections ({connections.length})</h4>
          {connections.length === 0 && <div className="props-empty">Not connected to anything yet — draw an edge from the canvas.</div>}
          {connections.length > 0 && (
            <ul className="props-connections">
              {connections.map((c) => (
                <li key={c.edgeId}>
                  <span className="props-conn-arrow">{c.outgoing ? "→" : "←"}</span>
                  <span className="props-conn-label">{c.otherLabel}</span>
                  {c.edgeLabel && <span className="props-conn-edge-label">{c.edgeLabel}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Real tags from the discovered resource — every resource type,
            not just ones with a hand-picked field for it */}
        {localData.tags && Object.keys(localData.tags).length > 0 && (
          <div className="props-section">
            <h4>Tags ({Object.keys(localData.tags).length})</h4>
            <ul className="props-tags">
              {Object.entries(localData.tags).map(([key, value]) => (
                <li key={key}>
                  <span className="props-tag-key">{key}</span>
                  <span className="props-tag-value">{value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Network attachment — VPC/subnet/IPs/attached security groups —
            for any resource type that has networkInfo, not just the
            type-specific sections below */}
        {localData.networkInfo && Object.values(localData.networkInfo).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v))) && (
          <div className="props-section">
            <h4>Network</h4>
            {localData.networkInfo.vpcId && (
              <div className="props-net-row">
                <span>VPC</span>
                <span>{localData.networkInfo.vpcId}</span>
              </div>
            )}
            {localData.networkInfo.subnetId && (
              <div className="props-net-row">
                <span>Subnet</span>
                <span>{localData.networkInfo.subnetId}</span>
              </div>
            )}
            {localData.networkInfo.privateIps && localData.networkInfo.privateIps.length > 0 && (
              <div className="props-net-row">
                <span>Private IP</span>
                <span>{localData.networkInfo.privateIps.join(", ")}</span>
              </div>
            )}
            {localData.networkInfo.publicIps && localData.networkInfo.publicIps.length > 0 && (
              <div className="props-net-row">
                <span>Public IP</span>
                <span>{localData.networkInfo.publicIps.join(", ")}</span>
              </div>
            )}
            {localData.networkInfo.securityGroups && localData.networkInfo.securityGroups.length > 0 && (
              <div className="props-net-row">
                <span>Security groups</span>
                <span>{localData.networkInfo.securityGroups.join(", ")}</span>
              </div>
            )}
          </div>
        )}

        {/* Real inbound/outbound rules — only present for security groups
            discovered via a real cloud sync (see infraCloudSync.ts's
            parseSecurityGroupRules) */}
        {((localData.inboundRules && localData.inboundRules.length > 0) || (localData.outboundRules && localData.outboundRules.length > 0)) && (
          <div className="props-section">
            <h4>Ports</h4>
            {localData.inboundRules && localData.inboundRules.length > 0 && (
              <>
                <div className="props-rules-label">Inbound</div>
                <ul className="props-rules">
                  {localData.inboundRules.map((rule, i) => (
                    <li key={`in-${i}`}>{formatRule(rule)}</li>
                  ))}
                </ul>
              </>
            )}
            {localData.outboundRules && localData.outboundRules.length > 0 && (
              <>
                <div className="props-rules-label">Outbound</div>
                <ul className="props-rules">
                  {localData.outboundRules.map((rule, i) => (
                    <li key={`out-${i}`}>{formatRule(rule)}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

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

function AccessSection({
  resourceId,
  linkedConnectionId,
  onChanged,
}: {
  resourceId: string;
  linkedConnectionId?: string;
  onChanged?: () => void;
}) {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [summary, setSummary] = useState<ConnectionAccessSummary | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchConnections()
      .then(setConnections)
      .catch(() => setConnections([]));
  }, []);

  useEffect(() => {
    setSummary(null);
    if (!linkedConnectionId) return;
    fetchConnectionAccessSummary(linkedConnectionId)
      .then(setSummary)
      .catch((e) => setError(e instanceof Error ? e.message : "failed to load access summary"));
  }, [linkedConnectionId]);

  async function link(connectionId: string | null) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/infra/resources/${encodeURIComponent(resourceId)}/link-connection`, {
        method: "PUT",
        body: JSON.stringify({ connectionId }),
      });
      setSelected("");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "link failed");
    } finally {
      setBusy(false);
    }
  }

  const linkedConnection = connections?.find((c) => c.id === linkedConnectionId);

  return (
    <div className="props-section">
      <h4>Access</h4>
      {!linkedConnectionId && (
        <>
          <p className="props-empty">
            Not linked to a Connection yet — link it to see who can actually access it. Infra discovery and
            RBAC-protected Connections are separate systems; nothing is access-controlled here until you link one.
          </p>
          <div className="form-row" style={{ marginTop: 8 }}>
            <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={!connections}>
              <option value="">{connections ? "Select a connection..." : "Loading..."}</option>
              {connections?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.hostname} ({c.type})
                </option>
              ))}
            </select>
            <button type="button" className="secondary" disabled={!selected || busy} onClick={() => link(selected)}>
              {busy ? "Linking…" : "Link"}
            </button>
          </div>
        </>
      )}

      {linkedConnectionId && (
        <>
          <div className="props-net-row">
            <span>Linked to</span>
            <span>{linkedConnection?.hostname ?? linkedConnectionId}</span>
          </div>
          <button type="button" className="link" style={{ padding: 0, marginBottom: 8 }} disabled={busy} onClick={() => link(null)}>
            Unlink
          </button>

          {!summary && !error && <p className="props-empty">Loading access data…</p>}
          {error && <p className="props-empty">{error}</p>}
          {summary && (
            <>
              <div className="props-rules-label">Can access ({summary.canAccess.length})</div>
              {summary.canAccess.length === 0 && <p className="props-empty">Nobody can currently reach this resource.</p>}
              <ul className="props-tags" style={{ marginBottom: 10 }}>
                {summary.canAccess.map((a) => (
                  <li key={a.username} title={a.viaRoles.length ? `via ${a.viaRoles.join(", ")}` : "direct assignment"}>
                    <span className="props-tag-key">{a.username}</span>
                    <span className="props-tag-value">{a.viaRoles.join(", ") || "direct"}</span>
                  </li>
                ))}
              </ul>

              <div className="props-rules-label">Recent denials</div>
              {summary.recentDenials.length === 0 && <p className="props-empty">None in the last 30 days.</p>}
              {summary.recentDenials.length > 0 && (
                <ul className="props-connections">
                  {summary.recentDenials.map((d, i) => (
                    <li key={i}>
                      <StatusBadge tone="danger">{d.username}</StatusBadge>
                      <span className="props-conn-label">{new Date(d.ts).toLocaleDateString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
