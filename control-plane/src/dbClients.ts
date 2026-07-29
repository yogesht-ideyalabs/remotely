/**
 * Small engine-agnostic wrapper around `pg` and `mysql2` so the database
 * session WS handler in index.ts doesn't need to branch on engine at every
 * call site — connect/query/end look identical from the caller's side
 * regardless of which real client library is underneath.
 *
 * Author: Yogesh Tiwari
 */

import { Client as PgClient } from "pg";
import mysql from "mysql2/promise";

export type DbEngine = "postgres" | "mysql" | "mongodb" | "redis";

export interface DbQueryResult {
  columns: string[];
  rows: unknown[];
  rowCount: number | null;
}

export interface DbClient {
  connect(): Promise<void>;
  query(sql: string): Promise<DbQueryResult>;
  end(): Promise<void>;
}

export interface DbConnectOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
  connectTimeoutMs: number;
}

class PostgresDbClient implements DbClient {
  private client: PgClient;
  constructor(opts: DbConnectOptions) {
    this.client = new PgClient({
      host: opts.host,
      port: opts.port,
      user: opts.user,
      password: opts.password,
      database: opts.database || undefined,
      connectionTimeoutMillis: opts.connectTimeoutMs,
    });
  }
  async connect() {
    await this.client.connect();
  }
  async query(sql: string): Promise<DbQueryResult> {
    const result = await this.client.query(sql);
    return { columns: result.fields?.map((f) => f.name) ?? [], rows: result.rows, rowCount: result.rowCount };
  }
  async end() {
    await this.client.end();
  }
}

class MysqlDbClient implements DbClient {
  private opts: DbConnectOptions;
  private conn: mysql.Connection | null = null;
  constructor(opts: DbConnectOptions) {
    this.opts = opts;
  }
  async connect() {
    this.conn = await mysql.createConnection({
      host: this.opts.host,
      port: this.opts.port,
      user: this.opts.user,
      password: this.opts.password,
      database: this.opts.database || undefined,
      connectTimeout: this.opts.connectTimeoutMs,
    });
  }
  async query(sql: string): Promise<DbQueryResult> {
    // mysql2 returns two different shapes depending on statement kind: an
    // array of row objects (+ a parallel FieldPacket[]) for SELECT, or a
    // single ResultSetHeader (affectedRows/insertId, no row data at all)
    // for INSERT/UPDATE/DDL — unlike pg, which always returns the same
    // QueryResult shape regardless of statement type. Both need handling
    // here so an UPDATE doesn't come back looking like a crash.
    const [result, fields] = await this.conn!.query(sql);
    if (Array.isArray(result)) {
      const columns = Array.isArray(fields) ? fields.map((f) => f.name) : [];
      return { columns, rows: result, rowCount: result.length };
    }
    const header = result as mysql.ResultSetHeader;
    return { columns: ["affectedRows", "insertId"], rows: [{ affectedRows: header.affectedRows, insertId: header.insertId }], rowCount: header.affectedRows ?? null };
  }
  async end() {
    await this.conn?.end();
  }
}

class MongoDbClient implements DbClient {
  private opts: DbConnectOptions;
  private client: import("mongodb").MongoClient | null = null;
  private db: import("mongodb").Db | null = null;

  constructor(opts: DbConnectOptions) {
    this.opts = opts;
  }

  async connect() {
    const { MongoClient } = await import("mongodb");
    const authPart = this.opts.user ? `${encodeURIComponent(this.opts.user)}:${encodeURIComponent(this.opts.password)}@` : "";
    const dbName = this.opts.database || "admin";
    const uri = `mongodb://${authPart}${this.opts.host}:${this.opts.port}/${dbName}?connectTimeoutMS=${this.opts.connectTimeoutMs}&authSource=admin`;
    this.client = new MongoClient(uri);
    await this.client.connect();
    this.db = this.client.db(dbName);
  }

  async query(command: string): Promise<DbQueryResult> {
    if (!this.db) throw new Error("Not connected");

    // Parse the command as JSON (MongoDB commands are JSON objects)
    // Support both raw JSON commands and simple helper syntax
    const trimmed = command.trim();

    // Helper syntax: db.collection.find({...}) or db.collection.insertOne({...})
    const helperMatch = trimmed.match(/^db\.(\w+)\.(\w+)\((.*)\)$/s);
    if (helperMatch) {
      const [, collName, method, argsStr] = helperMatch;
      const collection = this.db.collection(collName);
      const args = argsStr.trim() ? JSON.parse(`[${argsStr}]`) : [];

      switch (method) {
        case "find": {
          const docs = await collection.find(args[0] || {}).limit(args[1]?.limit || 100).toArray();
          const columns = docs.length > 0 ? Object.keys(docs[0]) : ["_id"];
          return { columns, rows: docs, rowCount: docs.length };
        }
        case "findOne": {
          const doc = await collection.findOne(args[0] || {});
          if (!doc) return { columns: [], rows: [], rowCount: 0 };
          return { columns: Object.keys(doc), rows: [doc], rowCount: 1 };
        }
        case "insertOne": {
          const result = await collection.insertOne(args[0] || {});
          return { columns: ["insertedId"], rows: [{ insertedId: result.insertedId }], rowCount: 1 };
        }
        case "insertMany": {
          const result = await collection.insertMany(args[0] || []);
          return { columns: ["insertedCount"], rows: [{ insertedCount: result.insertedCount }], rowCount: result.insertedCount };
        }
        case "updateOne":
        case "updateMany": {
          const result = await collection[method](args[0] || {}, args[1] || {});
          return { columns: ["matchedCount", "modifiedCount"], rows: [{ matchedCount: result.matchedCount, modifiedCount: result.modifiedCount }], rowCount: result.modifiedCount };
        }
        case "deleteOne":
        case "deleteMany": {
          const result = await collection[method](args[0] || {});
          return { columns: ["deletedCount"], rows: [{ deletedCount: result.deletedCount }], rowCount: result.deletedCount };
        }
        case "countDocuments": {
          const count = await collection.countDocuments(args[0] || {});
          return { columns: ["count"], rows: [{ count }], rowCount: 1 };
        }
        case "aggregate": {
          const docs = await collection.aggregate(args[0] || []).toArray();
          const columns = docs.length > 0 ? Object.keys(docs[0]) : [];
          return { columns, rows: docs, rowCount: docs.length };
        }
        default:
          throw new Error(`Unsupported MongoDB method: ${method}. Use find/findOne/insertOne/updateOne/deleteOne/aggregate/countDocuments.`);
      }
    }

    // Raw command syntax: { "listCollections": 1 } or { "dbStats": 1 }
    try {
      const cmdObj = JSON.parse(trimmed);
      const result = await this.db.command(cmdObj);
      // Flatten result for display
      if (result.cursor?.firstBatch) {
        const docs = result.cursor.firstBatch;
        const columns = docs.length > 0 ? Object.keys(docs[0]) : [];
        return { columns, rows: docs, rowCount: docs.length };
      }
      const columns = Object.keys(result).filter((k) => k !== "ok" && k !== "$clusterTime" && k !== "operationTime");
      return { columns, rows: [result], rowCount: 1 };
    } catch {
      throw new Error(
        'MongoDB commands should be either:\n' +
        '  • Helper syntax: db.collection.find({}) / db.collection.insertOne({...})\n' +
        '  • Raw command JSON: {"listCollections": 1} / {"dbStats": 1}'
      );
    }
  }

  async end() {
    await this.client?.close();
  }
}

class RedisDbClient implements DbClient {
  private opts: DbConnectOptions;
  private client: import("redis").RedisClientType | null = null;

  constructor(opts: DbConnectOptions) {
    this.opts = opts;
  }

  async connect() {
    const { createClient } = await import("redis");
    const authPart = this.opts.password ? `:${this.opts.password}@` : "";
    const userPart = this.opts.user && this.opts.user !== "default" ? `${this.opts.user}:` : "";
    const url = `redis://${userPart}${authPart}${this.opts.host}:${this.opts.port}/${this.opts.database || "0"}`;
    this.client = createClient({ url, socket: { connectTimeout: this.opts.connectTimeoutMs } }) as import("redis").RedisClientType;
    await this.client.connect();
  }

  async query(command: string): Promise<DbQueryResult> {
    if (!this.client) throw new Error("Not connected");

    // Parse Redis commands: "GET key", "SET key value", "HGETALL key", etc.
    const parts = parseRedisCommand(command.trim());
    if (parts.length === 0) throw new Error("Empty command");

    const cmd = parts[0].toUpperCase();
    const args = parts.slice(1);

    // Execute via sendCommand (raw, supports any Redis command)
    const result = await this.client.sendCommand([cmd, ...args]);

    // Format result for tabular display
    if (result === null || result === undefined) {
      return { columns: ["result"], rows: [{ result: "(nil)" }], rowCount: 1 };
    }
    if (typeof result === "string" || typeof result === "number") {
      return { columns: ["result"], rows: [{ result }], rowCount: 1 };
    }
    if (Array.isArray(result)) {
      // HGETALL returns alternating key/value pairs
      if (cmd === "HGETALL" && result.length % 2 === 0 && result.length > 0) {
        const obj: Record<string, string> = {};
        for (let i = 0; i < result.length; i += 2) {
          obj[String(result[i])] = String(result[i + 1]);
        }
        return { columns: Object.keys(obj), rows: [obj], rowCount: 1 };
      }
      // Lists, sets, sorted sets
      const rows = result.map((item, idx) => ({ index: idx, value: String(item) }));
      return { columns: ["index", "value"], rows, rowCount: rows.length };
    }
    return { columns: ["result"], rows: [{ result: JSON.stringify(result) }], rowCount: 1 };
  }

  async end() {
    await this.client?.disconnect();
  }
}

/** Parse a Redis command string respecting quoted strings */
function parseRedisCommand(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuote) {
      if (ch === inQuote) { inQuote = null; }
      else { current += ch; }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) { parts.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function createDbClient(engine: DbEngine, opts: DbConnectOptions): DbClient {
  switch (engine) {
    case "mysql": return new MysqlDbClient(opts);
    case "mongodb": return new MongoDbClient(opts);
    case "redis": return new RedisDbClient(opts);
    default: return new PostgresDbClient(opts);
  }
}
