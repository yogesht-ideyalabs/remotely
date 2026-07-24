/**
 * Infrastructure Snapshots — point-in-time captures for versioning and diff.
 *
 * Take a snapshot → compare two snapshots to see what changed:
 * - New resources (appeared since last snapshot)
 * - Removed resources (gone since last snapshot)
 * - Modified resources (properties changed)
 *
 * Author: Yogesh Tiwari
 */

import crypto from "node:crypto";
import { loadTable, saveRow, deleteRow } from "./db.js";
import { infraResources, type InfraResource } from "./infraDiscovery.js";

export interface InfraSnapshot {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  createdBy: string;
  resourceCount: number;
  // Stored as a compact representation (not the full resource objects)
  resources: SnapshotResource[];
}

interface SnapshotResource {
  externalId: string;
  provider: string;
  region: string;
  type: string;
  name: string;
  // Hash of the properties for quick diff comparison
  propsHash: string;
  // Key properties for display in diff
  keyProps: Record<string, unknown>;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

export const infraSnapshots: InfraSnapshot[] = loadTable<InfraSnapshot>("infraSnapshots");

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function listSnapshots(): Omit<InfraSnapshot, "resources">[] {
  return infraSnapshots.map(({ resources: _resources, ...rest }) => rest);
}

export function getSnapshot(id: string): InfraSnapshot | undefined {
  return infraSnapshots.find((s) => s.id === id);
}

/**
 * Take a snapshot of current infrastructure state.
 */
export function takeSnapshot(name: string, description: string, createdBy: string): InfraSnapshot {
  const resources: SnapshotResource[] = infraResources.map((r) => ({
    externalId: r.externalId,
    provider: r.provider,
    region: r.region,
    type: r.type,
    name: r.name,
    propsHash: hashProps(r.properties),
    keyProps: extractKeyProps(r),
  }));

  const snapshot: InfraSnapshot = {
    id: crypto.randomUUID(),
    name,
    description,
    createdAt: Date.now(),
    createdBy,
    resourceCount: resources.length,
    resources,
  };

  infraSnapshots.push(snapshot);
  saveRow("infraSnapshots", snapshot.id, snapshot);
  return snapshot;
}

export function deleteSnapshot(id: string): boolean {
  const idx = infraSnapshots.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  infraSnapshots.splice(idx, 1);
  deleteRow("infraSnapshots", id);
  return true;
}

// ─── Diff ────────────────────────────────────────────────────────────────────

export interface SnapshotDiff {
  fromSnapshot: { id: string; name: string; createdAt: number };
  toSnapshot: { id: string; name: string; createdAt: number } | { id: "current"; name: "Live Infrastructure"; createdAt: number };
  added: SnapshotResource[];
  removed: SnapshotResource[];
  modified: { resource: SnapshotResource; previousProps: Record<string, unknown> }[];
  unchanged: number;
}

/**
 * Compare two snapshots or a snapshot against current live state.
 */
export function diffSnapshots(fromId: string, toId: string | "current"): SnapshotDiff | null {
  const fromSnapshot = getSnapshot(fromId);
  if (!fromSnapshot) return null;

  let toResources: SnapshotResource[];
  let toMeta: SnapshotDiff["toSnapshot"];

  if (toId === "current") {
    toResources = infraResources.map((r) => ({
      externalId: r.externalId,
      provider: r.provider,
      region: r.region,
      type: r.type,
      name: r.name,
      propsHash: hashProps(r.properties),
      keyProps: extractKeyProps(r),
    }));
    toMeta = { id: "current", name: "Live Infrastructure", createdAt: Date.now() };
  } else {
    const toSnapshot = getSnapshot(toId);
    if (!toSnapshot) return null;
    toResources = toSnapshot.resources;
    toMeta = { id: toSnapshot.id, name: toSnapshot.name, createdAt: toSnapshot.createdAt };
  }

  // Build lookup maps
  const fromMap = new Map(fromSnapshot.resources.map((r) => [r.externalId, r]));
  const toMap = new Map(toResources.map((r) => [r.externalId, r]));

  const added: SnapshotResource[] = [];
  const removed: SnapshotResource[] = [];
  const modified: { resource: SnapshotResource; previousProps: Record<string, unknown> }[] = [];
  let unchanged = 0;

  // Find added and modified
  for (const [extId, toRes] of toMap) {
    const fromRes = fromMap.get(extId);
    if (!fromRes) {
      added.push(toRes);
    } else if (fromRes.propsHash !== toRes.propsHash) {
      modified.push({ resource: toRes, previousProps: fromRes.keyProps });
    } else {
      unchanged++;
    }
  }

  // Find removed
  for (const [extId, fromRes] of fromMap) {
    if (!toMap.has(extId)) {
      removed.push(fromRes);
    }
  }

  return {
    fromSnapshot: { id: fromSnapshot.id, name: fromSnapshot.name, createdAt: fromSnapshot.createdAt },
    toSnapshot: toMeta,
    added,
    removed,
    modified,
    unchanged,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashProps(props: Record<string, unknown>): string {
  const stable = JSON.stringify(props, Object.keys(props).sort());
  return crypto.createHash("md5").update(stable).digest("hex");
}

function extractKeyProps(r: InfraResource): Record<string, unknown> {
  // Extract the most interesting properties for display in diffs
  const { properties } = r;
  const keys = ["state", "instanceType", "engine", "cidr", "scheme", "runtime", "status"];
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in properties) result[key] = properties[key];
  }
  if (r.networkInfo?.vpcId) result.vpcId = r.networkInfo.vpcId;
  if (r.networkInfo?.privateIps?.length) result.privateIp = r.networkInfo.privateIps[0];
  return result;
}
