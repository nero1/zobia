/**
 * lib/db/drizzle.ts
 *
 * Typed Drizzle ORM instance shared by all three providers (Supabase,
 * Railway, DigitalOcean). Every provider adapter already talks to Postgres
 * directly through the `pg` driver (see lib/db/providers/*.ts), so this
 * module simply wraps the *same* pg.Pool in Drizzle's query builder — it
 * does not open a second connection or change how any provider
 * authenticates or enforces RLS.
 *
 * This is the primary data-access surface for application code. New code,
 * and code being migrated off raw SQL strings, should import `getDb()`
 * from here rather than `db.query()` from `@/lib/db`.
 *
 * Usage:
 *   import { getDb, schema } from '@/lib/db/drizzle';
 *   import { eq } from 'drizzle-orm';
 *
 *   const orm = await getDb();
 *   const [user] = await orm.select().from(schema.users).where(eq(schema.users.id, id));
 *
 * Transactions:
 *   const orm = await getDb();
 *   await orm.transaction(async (tx) => {
 *     await tx.update(schema.users).set({ coins: sql`${schema.users.coins} + 10` }).where(...);
 *     await tx.insert(schema.coinLedger).values({...});
 *   });
 *
 * `@/lib/db` (the raw `db.query()` adapter) remains available as a fallback
 * for the rare statement that genuinely cannot be expressed through
 * Drizzle's builder or its `sql` template tag (e.g. dynamic DDL, admin
 * introspection scripts) — new application/business-logic code should not
 * need it.
 */

import { env } from "@/lib/env";
import { schema } from "./schema";

// ---------------------------------------------------------------------------
// Drizzle type exports (imported from schema for re-export convenience)
// ---------------------------------------------------------------------------

export type {
  User,
  NewUser,
  Follow,
  Report,
  ModerationAction,
  Notification,
  CoinLedger,
  CoinLedgerEntry,
  XpLedger,
  XpLedgerEntry,
  FailedXpAward,
  Payment,
  Referral,
  ReferralCommission,
  CreatorPayout,
  QuestTemplate,
  UserQuestProgress,
  UserQuestDeck,
  LeaderboardSnapshot,
  GuildQuest,
  UserBadge,
  RoomMessage,
} from "./schema";

// ---------------------------------------------------------------------------
// Typed Drizzle instance — lazy singleton, shared with the provider's pool
// ---------------------------------------------------------------------------

type DrizzleDb = ReturnType<typeof import("drizzle-orm/node-postgres").drizzle<typeof schema>>;

/**
 * A Drizzle client that is either the top-level `getDb()` instance or a
 * transaction handle passed into `.transaction(async (tx) => ...)`. Shared
 * helpers that may be called either standalone or inside a transaction
 * should accept this type instead of `DrizzleDb` directly.
 */
export type DbOrTx = DrizzleDb | Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

let _drizzleDb: DrizzleDb | null = null;

/**
 * Returns a typed Drizzle query-builder instance backed by the same pg.Pool
 * used by the active provider's adapter (Supabase, Railway, or
 * DigitalOcean). All three providers connect to plain Postgres via `pg`, so
 * a single Drizzle wrapper works uniformly across them.
 *
 * The instance is lazily created on first call and cached for the process
 * lifetime, so pool connections are shared with the base adapter — calling
 * this does not open a second connection to the database.
 */
export async function getDb(): Promise<DrizzleDb> {
  if (_drizzleDb) return _drizzleDb;

  const provider = env.DATABASE_PROVIDER;
  const { drizzle } = await import("drizzle-orm/node-postgres");

  let pool: import("pg").Pool;
  if (provider === "digitalocean") {
    const { getPool } = await import("./providers/digitalocean");
    pool = getPool();
  } else if (provider === "railway") {
    const { getPool } = await import("./providers/railway");
    pool = getPool();
  } else {
    // Default: supabase (or any pg-compatible provider)
    const { getPool } = await import("./providers/supabase");
    pool = getPool();
  }

  _drizzleDb = drizzle(pool, { schema }) as DrizzleDb;
  return _drizzleDb;
}

/**
 * @deprecated Use {@link getDb} instead. Kept only for the brief overlap
 * window while callers are migrated off the old name.
 */
export async function getTypedDb(): Promise<DrizzleDb> {
  return getDb();
}

/**
 * Reset the cached Drizzle instance (for testing or after pool errors).
 */
export function resetTypedDb(): void {
  _drizzleDb = null;
}

// Re-export schema for convenience
export { schema };
