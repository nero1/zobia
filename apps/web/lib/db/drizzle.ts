/**
 * lib/db/drizzle.ts
 *
 * Typed Drizzle ORM instance for providers that use the `pg` driver
 * (Railway and DigitalOcean). This gives the application a type-safe query
 * builder on top of the existing DatabaseAdapter interface.
 *
 * Usage:
 *   import { getTypedDb } from '@/lib/db/drizzle';
 *   const tdb = getTypedDb();      // null when provider is 'supabase'
 *   if (tdb) {
 *     const [user] = await tdb.select().from(schema.users).where(eq(schema.users.id, id));
 *   }
 *
 * The adapter-agnostic raw `db` from lib/db/index.ts remains the primary
 * interface for all providers. This module is additive — it does not replace
 * the existing adapter; it layers type-safe queries on top.
 */

import { env } from "@/lib/env";
import { schema } from "./schema";

// ---------------------------------------------------------------------------
// Drizzle type exports (imported from schema for re-export convenience)
// ---------------------------------------------------------------------------

export type {
  User,
  NewUser,
  Session,
  Follow,
  Report,
  ModerationAction,
  Notification,
  CoinLedgerEntry,
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
// Typed Drizzle instance — lazy singleton
// ---------------------------------------------------------------------------

type DrizzleDb = ReturnType<typeof import("drizzle-orm/node-postgres").drizzle<typeof schema>>;

let _drizzleDb: DrizzleDb | null = null;

/**
 * Returns a typed Drizzle query-builder instance backed by the same pg.Pool
 * used by the Railway / DigitalOcean adapters.
 *
 * Returns `null` when DATABASE_PROVIDER is 'supabase' (Supabase uses its own
 * JS client; for that provider continue using the raw `db` adapter).
 *
 * The instance is lazily created on first call and cached for the process
 * lifetime, so pool connections are shared with the base adapter.
 */
export async function getTypedDb(): Promise<DrizzleDb | null> {
  if (_drizzleDb) return _drizzleDb;

  const provider = env.DATABASE_PROVIDER;
  if (provider === "supabase") {
    return null;
  }

  // Dynamically import to avoid bundling pg in environments that don't need it
  const [{ Pool }, { drizzle }] = await Promise.all([
    import("pg"),
    import("drizzle-orm/node-postgres"),
  ]);

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl:
      env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    max: parseInt(process.env.DB_POOL_SIZE ?? "2", 10),
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 8_000,
    options:
      "-c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000",
  });

  _drizzleDb = drizzle(pool, { schema }) as DrizzleDb;
  return _drizzleDb;
}

/**
 * Reset the cached Drizzle instance (for testing or after pool errors).
 */
export function resetTypedDb(): void {
  _drizzleDb = null;
}

// Re-export schema for convenience
export { schema };
