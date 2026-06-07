/**
 * lib/db/providers/railway.ts
 *
 * Railway PostgreSQL adapter.
 *
 * Railway provides managed Postgres with optional PgBouncer pooling.
 * This adapter uses the `pg` driver with a connection pool tuned for
 * Railway's environment (smaller max connections, aggressive timeouts).
 */

import { Pool, PoolClient } from "pg";
import type {
  DatabaseAdapter,
  QueryResult,
  SqlParam,
  TransactionClient,
} from "../interface";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

let _pool: Pool | null = null;

/**
 * Returns the shared pg Pool for Railway, creating it on first call.
 * Uses DATABASE_URL for pooled connections (PgBouncer if configured),
 * and DIRECT_URL for transactions that require a persistent connection.
 */
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl:
        env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : undefined,
      // Railway recommends keeping pool size small to avoid exhaustion
      max: 5,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 8_000,
    });

    _pool.on("error", (err) => {
      console.error("[db:railway] pool error", err);
    });
  }
  return _pool;
}

/** Separate pool for direct connections (migrations, long transactions). */
let _directPool: Pool | null = null;

function getDirectPool(): Pool {
  if (!_directPool) {
    _directPool = new Pool({
      connectionString: env.DIRECT_URL,
      ssl:
        env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : undefined,
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
    });

    _directPool.on("error", (err) => {
      console.error("[db:railway:direct] pool error", err);
    });
  }
  return _directPool;
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

/**
 * Railway PostgreSQL adapter backed by `pg` with PgBouncer support.
 * Short queries use the pooled connection string; transactions that must
 * hold a real connection use DIRECT_URL.
 */
export class RailwayDatabaseAdapter implements DatabaseAdapter {
  /** @inheritdoc */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: SqlParam[]
  ): Promise<QueryResult<T>> {
    const pool = getPool();
    const result = await pool.query<T & Record<string, unknown>>(sql, params as unknown[]);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  }

  /** @inheritdoc */
  async transaction<T>(
    fn: (client: TransactionClient) => Promise<T>
  ): Promise<T> {
    // Use the direct pool so PgBouncer does not interfere with BEGIN/COMMIT
    const directPool = getDirectPool();
    const client: PoolClient = await directPool.connect();

    try {
      await client.query("BEGIN");

      const txClient: TransactionClient = {
        query: async <R = Record<string, unknown>>(
          sql: string,
          params?: SqlParam[]
        ): Promise<QueryResult<R>> => {
          const res = await client.query<R & Record<string, unknown>>(sql, params as unknown[]);
          return { rows: res.rows as R[], rowCount: res.rowCount ?? 0 };
        },
      };

      const result = await fn(txClient);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** @inheritdoc */
  async healthCheck(): Promise<boolean> {
    try {
      const { rows } = await this.query<{ ok: number }>("SELECT 1 AS ok");
      return rows[0]?.ok === 1;
    } catch {
      return false;
    }
  }

  /** @inheritdoc */
  async close(): Promise<void> {
    const tasks: Promise<void>[] = [];
    if (_pool) { tasks.push(_pool.end()); _pool = null; }
    if (_directPool) { tasks.push(_directPool.end()); _directPool = null; }
    await Promise.all(tasks);
  }
}
