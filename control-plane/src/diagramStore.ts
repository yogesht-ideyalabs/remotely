/**
 * Saved diagram persistence — shared by the manual save/load flow
 * (infraRoutes.ts) and the auto-generated diagrams (autoDiagram.ts).
 * Split out of infraRoutes.ts once a second consumer needed it.
 */

import crypto from "node:crypto";
import { loadTable, saveRow, deleteRow } from "./db.js";

export interface DiagramPage {
  id: string;
  name: string;
  nodes: unknown[];
  edges: unknown[];
}

export interface SavedDiagram {
  id: string;
  name: string;
  // Always mirrors the first page's content — kept for every existing
  // consumer that only ever knew about a single nodes/edges pair
  // (Architecture.tsx's read-only viewer, the Load modal's node-count
  // display, auto-generated diagrams, which never have `pages` at all).
  // Multi-page-aware code (the editor itself) reads `pages` instead.
  nodes: unknown[];
  edges: unknown[];
  // Present only for manually-created/edited diagrams that use more than
  // one page. Auto-generated diagrams never have this — one auto-diagram
  // is one page by definition.
  pages?: DiagramPage[];
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  // Auto-generated diagrams (see autoDiagram.ts) are regenerated in place
  // on every infra sync rather than accumulating duplicates — autoKey is
  // the stable identity used to find "the same" diagram across
  // regenerations (e.g. "auto:by-provider:aws"). Manually-created/edited
  // diagrams have no autoKey.
  isAuto?: boolean;
  autoKey?: string;
  autoDescription?: string;
}

export const savedDiagrams: SavedDiagram[] = loadTable<SavedDiagram>("infraDiagrams");

// Version history — every manual save of a diagram snapshots the state it's
// REPLACING (not the new state; the new state is always available as the
// current SavedDiagram row itself) before overwriting. Auto-generated
// diagrams never version — they regenerate from live infra on every sync,
// so "history" would just be sync noise, not user-authored edits worth
// browsing.
export interface DiagramVersion {
  id: string;
  diagramId: string;
  versionNumber: number;
  name: string;
  nodes: unknown[];
  edges: unknown[];
  pages?: DiagramPage[];
  savedAt: number;
  savedBy: string;
}

export const diagramVersions: DiagramVersion[] = loadTable<DiagramVersion>("infraDiagramVersions");

export function listDiagramVersions(diagramId: string): DiagramVersion[] {
  return diagramVersions
    .filter((v) => v.diagramId === diagramId)
    .sort((a, b) => b.versionNumber - a.versionNumber);
}

export function getDiagramVersion(diagramId: string, versionId: string): DiagramVersion | undefined {
  return diagramVersions.find((v) => v.diagramId === diagramId && v.id === versionId);
}

function snapshotVersion(diagram: SavedDiagram, savedBy: string): DiagramVersion {
  const priorCount = diagramVersions.filter((v) => v.diagramId === diagram.id).length;
  const version: DiagramVersion = {
    id: crypto.randomUUID(),
    diagramId: diagram.id,
    versionNumber: priorCount + 1,
    name: diagram.name,
    nodes: diagram.nodes,
    edges: diagram.edges,
    pages: diagram.pages,
    savedAt: diagram.updatedAt,
    savedBy,
  };
  diagramVersions.push(version);
  saveRow("infraDiagramVersions", version.id, version);
  return version;
}

export function listSavedDiagrams(): SavedDiagram[] {
  return savedDiagrams;
}

export function getSavedDiagram(id: string): SavedDiagram | undefined {
  return savedDiagrams.find((d) => d.id === id);
}

export function upsertSavedDiagram(
  id: string | undefined,
  data: { name: string; nodes: unknown[]; edges: unknown[]; pages?: DiagramPage[] },
  createdBy: string
): SavedDiagram {
  if (id) {
    const existing = savedDiagrams.find((d) => d.id === id);
    if (existing) {
      // Snapshot what's about to be overwritten, not the incoming data —
      // the incoming save is always recoverable as-is (it's what's now
      // live), so history only needs to remember what came before it.
      snapshotVersion(existing, createdBy);
      existing.name = data.name;
      existing.nodes = data.nodes;
      existing.edges = data.edges;
      existing.pages = data.pages;
      existing.updatedAt = Date.now();
      saveRow("infraDiagrams", existing.id, existing);
      return existing;
    }
  }

  const diagram: SavedDiagram = {
    id: crypto.randomUUID(),
    name: data.name,
    nodes: data.nodes,
    edges: data.edges,
    pages: data.pages,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy,
  };
  savedDiagrams.push(diagram);
  saveRow("infraDiagrams", diagram.id, diagram);
  return diagram;
}

// Regenerates in place by autoKey instead of creating a new row every
// time — otherwise every sync would leave behind another stale copy of
// "Auto: AWS" forever.
export function upsertAutoDiagram(autoKey: string, name: string, description: string, nodes: unknown[], edges: unknown[]): SavedDiagram {
  const existing = savedDiagrams.find((d) => d.autoKey === autoKey);
  if (existing) {
    existing.name = name;
    existing.autoDescription = description;
    existing.nodes = nodes;
    existing.edges = edges;
    existing.updatedAt = Date.now();
    saveRow("infraDiagrams", existing.id, existing);
    return existing;
  }

  const diagram: SavedDiagram = {
    id: crypto.randomUUID(),
    name,
    nodes,
    edges,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: "system",
    isAuto: true,
    autoKey,
    autoDescription: description,
  };
  savedDiagrams.push(diagram);
  saveRow("infraDiagrams", diagram.id, diagram);
  return diagram;
}

// Restoring is itself a save — it goes through upsertSavedDiagram so the
// state it replaces (whatever was live right before the restore) also gets
// snapshotted, same as any other edit. This keeps history append-only and
// git-like: restoring to version 3 doesn't delete versions 4-7, it just
// makes a new save whose content happens to match version 3.
export function restoreDiagramVersion(diagramId: string, versionId: string, restoredBy: string): SavedDiagram | undefined {
  const version = getDiagramVersion(diagramId, versionId);
  if (!version) return undefined;
  return upsertSavedDiagram(diagramId, { name: version.name, nodes: version.nodes, edges: version.edges, pages: version.pages }, restoredBy);
}

export function deleteSavedDiagram(id: string): SavedDiagram | undefined {
  const idx = savedDiagrams.findIndex((d) => d.id === id);
  if (idx === -1) return undefined;
  const [removed] = savedDiagrams.splice(idx, 1);
  deleteRow("infraDiagrams", removed.id);

  // Snapshot before mutating: don't splice diagramVersions while iterating
  // it directly (the exact array-mutation-during-iteration bug documented
  // in autoDiagram.ts's regenerateAutoDiagrams — same lesson applies here).
  const staleVersionIds = diagramVersions.filter((v) => v.diagramId === id).map((v) => v.id);
  for (const versionId of staleVersionIds) {
    const vIdx = diagramVersions.findIndex((v) => v.id === versionId);
    if (vIdx !== -1) diagramVersions.splice(vIdx, 1);
    deleteRow("infraDiagramVersions", versionId);
  }

  return removed;
}
