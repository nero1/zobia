/**
 * __tests__/integration/setup.ts
 *
 * Integration test database setup and teardown.
 *
 * Requires a real PostgreSQL database. Set TEST_DATABASE_URL before running:
 *
 *   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/zobia_test \
 *     npm run test:integration
 *
 * The test database is seeded by running all migration files in order.
 * Each test file runs its tests inside a transaction that is rolled back
 * after the test, keeping the database clean between tests.
 *
 * In CI, a fresh PostgreSQL service container is used (see
 * .github/workflows/integration-tests.yml).
 */

import { Pool, PoolClient } from "pg";
import * as fs from "fs";
import * as path from "path";
import type { DatabaseAdapter, QueryResult } from "@/lib/db/interface";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Absolute path to the migrations directory. */
const MIGRATIONS_DIR = path.resolve(__dirname, "../../db/migrations");

// ---------------------------------------------------------------------------
// Pool singleton
// ---------------------------------------------------------------------------

let _pool: Pool | null = null;

export function getTestPool(): Pool {
  if (!_pool) {
    if (!TEST_DATABASE_URL) {
      throw new Error(
        "TEST_DATABASE_URL is not set. " +
          "Set it to a test PostgreSQL connection string before running integration tests."
      );
    }
    _pool = new Pool({
      connectionString: TEST_DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return _pool;
}

export async function closeTestPool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

/**
 * Apply all migrations to the test database.
 * Tracks applied migrations in _test_applied_migrations so each file runs
 * exactly once even when multiple test suites call runMigrations().
 */
export async function runMigrations(): Promise<void> {
  const pool = getTestPool();
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _test_applied_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort(); // alphabetical order = chronological (001, 002, ...)

    for (const file of files) {
      const { rows } = await client.query(
        `SELECT 1 FROM _test_applied_migrations WHERE filename = $1`,
        [file]
      );
      if (rows.length > 0) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      await client.query(sql);

      await client.query(
        `INSERT INTO _test_applied_migrations (filename) VALUES ($1)`,
        [file]
      );
    }
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Transaction helper — each test runs in a rolled-back transaction
// ---------------------------------------------------------------------------

/**
 * Creates a scoped transaction client for a single test.
 * Call `rollback()` in afterEach to undo all test data.
 */
export async function createTestTransaction(): Promise<{
  client: PoolClient;
  rollback: () => Promise<void>;
}> {
  const pool = getTestPool();
  const client = await pool.connect();
  await client.query("BEGIN");

  return {
    client,
    rollback: async () => {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// DatabaseAdapter-compatible wrapper around a PoolClient
// ---------------------------------------------------------------------------

export type TestDbClient = DatabaseAdapter;

/**
 * Wraps a PoolClient in the same interface as lib/db/interface.DatabaseAdapter.
 * Lets you pass the test client directly to library functions.
 */
export function wrapClient(client: PoolClient): TestDbClient {
  const wrapped: TestDbClient = {
    async query<T = Record<string, unknown>>(
      sql: string,
      params?: Array<string | number | boolean | null | Date | Buffer>
    ): Promise<QueryResult<T>> {
      const result = await client.query(sql, params as unknown[]);
      return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
    },
    async transaction<T>(fn: (c: TestDbClient) => Promise<T>): Promise<T> {
      // Tests run inside an outer transaction; use savepoints for nested atomicity
      await client.query("SAVEPOINT sp_nested");
      try {
        const result = await fn(wrapClient(client));
        await client.query("RELEASE SAVEPOINT sp_nested");
        return result;
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT sp_nested");
        throw err;
      }
    },
    async healthCheck(): Promise<boolean> {
      const { rows } = await client.query("SELECT 1 AS ok");
      return (rows[0] as { ok: number } | undefined)?.ok === 1;
    },
    async close(): Promise<void> {
      // No-op: the outer test manages client lifecycle
    },
  };
  return wrapped;
}

// ---------------------------------------------------------------------------
// Global setup / teardown for Jest
// ---------------------------------------------------------------------------

/**
 * Call in beforeAll() of integration test suites.
 * Skips gracefully if TEST_DATABASE_URL is not set.
 */
export async function integrationSetup(): Promise<boolean> {
  if (!TEST_DATABASE_URL) {
    console.warn(
      "\n⚠  Skipping integration tests: TEST_DATABASE_URL is not set.\n" +
        "   Set it to a PostgreSQL test database URL to run these tests.\n"
    );
    return false;
  }

  await runMigrations();
  return true;
}
