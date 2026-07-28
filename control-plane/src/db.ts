import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Real persistence, replacing "everything lives in a plain JS array and is
// gone the moment the process exits" — the single biggest gap this whole
// POC has had, and the one everything built this session (SSH keys, MFA,
// access grants, agent identities, join tokens) was quietly resting on top
// of. Uses Node's built-in node:sqlite (stable in this Node version) —
// better-sqlite3 failed to compile natively earlier in this project, and
// node:sqlite needs no native build step at all, so it sidesteps that
// entirely.
//
// Schema is deliberately a document store (key + JSON blob per row), not
// fully normalized columns — every entity in store.ts already has a
// well-defined TypeScript shape and its own validation logic; duplicating
// that as a SQL schema would just be a second, easier-to-drift copy of the
// same information for no real benefit at this scale. What matters is that
// writes are durable and reads are fast, both of which a keyed blob table
// gives you for free.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.REMOTELY_DB_PATH ?? path.join(__dirname, "..", "remotely.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL"); // readers don't block the (rare, admin-driven) writer

const TABLES = ["users", "roles", "connections", "organizations", "sshKeys", "accessRequests", "joinTokens", "agentIdentities", "siemConfig", "infraAccounts", "infraResources", "infraDiagrams", "infraDiagramVersions", "infraSnapshots", "webhookPlugins", "notificationState", "smtpConfig", "monitors", "monitorChecks", "dashboardLayouts", "securityPolicy"] as const;
export type TableName = (typeof TABLES)[number];

for (const table of TABLES) {
  db.exec(`CREATE TABLE IF NOT EXISTS ${table} (key TEXT PRIMARY KEY, data TEXT NOT NULL)`);
}

export function loadTable<T>(table: TableName): T[] {
  const rows = db.prepare(`SELECT data FROM ${table}`).all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as T);
}

export function saveRow(table: TableName, key: string, value: unknown): void {
  db.prepare(`INSERT INTO ${table} (key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data`).run(
    key,
    JSON.stringify(value)
  );
}

export function deleteRow(table: TableName, key: string): void {
  db.prepare(`DELETE FROM ${table} WHERE key = ?`).run(key);
}

export function tableIsEmpty(table: TableName): boolean {
  const row = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
  return row.c === 0;
}
