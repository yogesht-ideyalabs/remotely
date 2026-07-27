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

export type DbEngine = "postgres" | "mysql";

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

export function createDbClient(engine: DbEngine, opts: DbConnectOptions): DbClient {
  return engine === "mysql" ? new MysqlDbClient(opts) : new PostgresDbClient(opts);
}
