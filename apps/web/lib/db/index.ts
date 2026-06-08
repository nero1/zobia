/**
 * lib/db/index.ts
 *
 * Database access entry point.
 *
 * Reads DATABASE_PROVIDER from the validated environment and returns the
 * correct adapter singleton. All application code should import `db` from
 * this module – never from a provider file directly.
 *
 * @example
 * ```ts
 * import { db } from '@/lib/db';
 * const { rows } = await db.query<User>('SELECT * FROM users WHERE id = $1', [userId]);
 * ```
 */

import { env } from "@/lib/env";
import type { DatabaseAdapter } from "./interface";
import { SupabaseDatabaseAdapter } from "./providers/supabase";
import { RailwayDatabaseAdapter } from "./providers/railway";
import { DigitalOceanDatabaseAdapter } from "./providers/digitalocean";

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _adapter: DatabaseAdapter | null = null;

/**
 * Returns the shared database adapter singleton.
 * The concrete implementation is selected based on the DATABASE_PROVIDER env var.
 * Throws if the provider value is unknown (should be caught by env validation).
 */
function createAdapter(): DatabaseAdapter {
  switch (env.DATABASE_PROVIDER) {
    case "supabase":
      return new SupabaseDatabaseAdapter();
    case "railway":
      return new RailwayDatabaseAdapter();
    case "digitalocean":
      return new DigitalOceanDatabaseAdapter();
    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = env.DATABASE_PROVIDER;
      throw new Error(
        `[db] Unknown DATABASE_PROVIDER: "${String(_exhaustive)}". ` +
        `Expected one of: "supabase", "railway", "digitalocean". ` +
        `Check that DATABASE_PROVIDER is set in your environment.`
      );
    }
  }
}

/**
 * The active database adapter.
 * Lazily instantiated on first access so the module is safe to import in
 * environments where the env vars are not yet loaded (e.g. test scaffolding).
 */
export const db: DatabaseAdapter = new Proxy({} as DatabaseAdapter, {
  get(_target, prop) {
    if (!_adapter) {
      _adapter = createAdapter();
    }
    const value = (_adapter as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === "function") {
      return value.bind(_adapter);
    }
    return value;
  },
});

/**
 * Gracefully release the adapter's connection pool.
 * Should be called on process shutdown (SIGTERM / SIGINT).
 */
export async function closeDb(): Promise<void> {
  if (_adapter) {
    await _adapter.close();
    _adapter = null;
  }
}

// Re-export the interface so callers can type against it without a deep import
export type { DatabaseAdapter, QueryResult, SqlParam, TransactionClient } from "./interface";
