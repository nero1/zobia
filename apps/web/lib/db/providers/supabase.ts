/**
 * lib/db/providers/supabase.ts
 *
 * Supabase database adapter.
 *
 * Connects to Supabase's underlying Postgres using the `pg` driver and
 * PgBouncer transaction pooling (via the pooler connection string).
 * This adapter does NOT use @supabase/supabase-js – all SQL is issued
 * directly through the pg Pool so the abstraction stays uniform.
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
 * Returns the shared pg Pool, creating it on first call.
 * Supabase exposes a PgBouncer pooler on port 6543 (transaction mode).
 * The DATABASE_URL should already point to that endpoint.
 */
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: env.DATABASE_URL,
      // Supabase enforces SSL in production
      ssl:
        env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    _pool.on("error", (err) => {
      console.error("[db:supabase] pool error", err);
    });
  }
  return _pool;
}

// ---------------------------------------------------------------------------
// Adapter implementation
// ---------------------------------------------------------------------------

/**
 * Supabase database adapter backed by `pg`.
 * All queries go through the PgBouncer pooler for optimal connection reuse.
 */
export class SupabaseDatabaseAdapter implements DatabaseAdapter {
  /** @inheritdoc */
  async query<T = Record<string, unknown>>(
    sql: string,
    params?: SqlParam[]
  ): Promise<QueryResult<T>> {
    const pool = getPool();
    const result = await pool.query<T>(sql, params as unknown[]);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  }

  /** @inheritdoc */
  async transaction<T>(
    fn: (client: TransactionClient) => Promise<T>
  ): Promise<T> {
    const pool = getPool();
    const client: PoolClient = await pool.connect();

    try {
      await client.query("BEGIN");

      const txClient: TransactionClient = {
        query: async <R = Record<string, unknown>>(
          sql: string,
          params?: SqlParam[]
        ): Promise<QueryResult<R>> => {
          const res = await client.query<R>(sql, params as unknown[]);
          return { rows: res.rows, rowCount: res.rowCount ?? 0 };
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
    if (_pool) {
      await _pool.end();
      _pool = null;
    }
  }
}
