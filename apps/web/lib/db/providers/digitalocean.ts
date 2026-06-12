/**
 * lib/db/providers/digitalocean.ts
 *
 * DigitalOcean Managed PostgreSQL adapter.
 *
 * DO Managed Postgres clusters expose a connection pooler (PgBouncer) on port
 * 25061 (transaction mode) and a direct port at 25060. This adapter uses the
 * `pg` driver with settings appropriate for DO's managed service – SSL is
 * always required in production, and the pool is sized conservatively for
 * serverless / edge-heavy deployments.
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
// Internal pools
// ---------------------------------------------------------------------------

let _pool: Pool | null = null;
let _directPool: Pool | null = null;

/**
 * Returns the shared pooled pg Pool for DO, creating it on first call.
 * DATABASE_URL should point to the DO PgBouncer pooler endpoint.
 */
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: env.DATABASE_URL,
      // DigitalOcean Managed Postgres always requires SSL
      ssl: { rejectUnauthorized: false },
      max: parseInt(process.env.DB_POOL_SIZE ?? "2", 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      // Guard against runaway queries monopolising the tiny pool (#21)
      options: "-c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000",
    });

    _pool.on("error", (err) => {
      console.error("[db:digitalocean] pool error", err);
    });
  }
  return _pool;
}

/**
 * Returns the direct (non-pooled) pg Pool for transactions.
 * DIRECT_URL should point to the DO primary at port 25060.
 */
function getDirectPool(): Pool {
  if (!_directPool) {
    _directPool = new Pool({
      connectionString: env.DIRECT_URL,
      ssl: { rejectUnauthorized: false },
      // Keep direct connections minimal; used only for transactions
      max: parseInt(process.env.DB_DIRECT_POOL_SIZE ?? "2", 10),
      idleTimeoutMillis: 15_000,
      connectionTimeoutMillis: 8_000,
    });

    _directPool.on("error", (err) => {
      console.error("[db:digitalocean:direct] pool error", err);
    });
  }
  return _directPool;
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

/**
 * DigitalOcean Managed PostgreSQL adapter backed by `pg`.
 * Pooled queries use the PgBouncer endpoint; transactions use the direct port
 * to avoid statement-level pooling issues with BEGIN/COMMIT.
 */
export class DigitalOceanDatabaseAdapter implements DatabaseAdapter {
  /** @inheritdoc */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: SqlParam[]
  ): Promise<QueryResult<T>> {
    const result = await getPool().query<T & Record<string, unknown>>(sql, params as unknown[]);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  }

  /** @inheritdoc */
  async transaction<T>(
    fn: (client: TransactionClient) => Promise<T>
  ): Promise<T> {
    const client: PoolClient = await getDirectPool().connect();

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
      try { await client.query("ROLLBACK"); } catch (rollbackErr) {
        console.error("[db] ROLLBACK failed:", rollbackErr);
      }
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
    if (_pool) {
      tasks.push(_pool.end());
      _pool = null;
    }
    if (_directPool) {
      tasks.push(_directPool.end());
      _directPool = null;
    }
    await Promise.all(tasks);
  }
}
