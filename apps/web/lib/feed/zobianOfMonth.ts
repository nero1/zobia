/**
 * lib/feed/zobianOfMonth.ts
 *
 * Zobian of the Month — read/cache/invalidate helpers shared by
 * GET /api/feed/zobian-of-month (public), POST /api/admin/zobian-of-month
 * (admin override) and /api/cron/feed-refresh (auto-compute).
 *
 * Two-tier memory+Redis cache, same pattern as lib/manifest/index.ts —
 * this changes at most once a month but is read on every Home Dashboard
 * load, so it must not hit the DB per request.
 */

import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { memGet, memSet, memDel } from "@/lib/cache/memory";

// REDIS-COST-01: this value changes at most once a month and is explicitly
// invalidated by both the admin override route and the feed-refresh CRON
// (see invalidateZobianOfMonthCache below), so the TTLs are a safety net
// rather than the propagation mechanism. They were set as if they were the
// latter, which meant every Home Dashboard load on a cold instance paid a
// Redis read for a value that had not changed in weeks.
const MEM_KEY = "zobian_of_month:current";
const MEM_TTL_MS = 300_000; // 5 minutes
const REDIS_KEY = "zobian_of_month:current:v1";
const REDIS_TTL_SECONDS = 21_600; // 6 hours

export interface ZobianOfMonthPublic {
  month: string;
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  avatarUrl: string | null;
  score: string | null;
  isAdminOverride: boolean;
  note: string | null;
}

export async function getCurrentZobianOfMonth(): Promise<ZobianOfMonthPublic | null> {
  const mem = memGet<ZobianOfMonthPublic | null>(MEM_KEY);
  if (mem !== undefined) return mem;

  try {
    const cached = await redis.get(REDIS_KEY);
    if (cached) {
      const parsed = cached === "null" ? null : (JSON.parse(cached) as ZobianOfMonthPublic);
      memSet(MEM_KEY, parsed, MEM_TTL_MS);
      return parsed;
    }
  } catch (err) {
    logger.error({ err }, "[zobian-of-month] Redis read failed — falling back to DB");
  }

  const db = await getDb();
  const [row] = await db
    .select({
      month: schema.zobianOfMonth.month,
      userId: schema.zobianOfMonth.userId,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatarEmoji: schema.users.avatarEmoji,
      avatarUrl: schema.users.avatarUrl,
      score: schema.zobianOfMonth.score,
      isAdminOverride: schema.zobianOfMonth.isAdminOverride,
      note: schema.zobianOfMonth.note,
    })
    .from(schema.zobianOfMonth)
    .innerJoin(schema.users, eq(schema.users.id, schema.zobianOfMonth.userId))
    .where(eq(schema.zobianOfMonth.month, sql`date_trunc('month', NOW())::date`))
    .limit(1);

  const result: ZobianOfMonthPublic | null = row
    ? {
        month: new Date(row.month).toISOString().slice(0, 10),
        userId: row.userId,
        username: row.username,
        displayName: row.displayName,
        avatarEmoji: row.avatarEmoji,
        avatarUrl: row.avatarUrl,
        score: row.score,
        isAdminOverride: row.isAdminOverride,
        note: row.note,
      }
    : null;

  memSet(MEM_KEY, result, MEM_TTL_MS);
  try {
    await redis.setex(REDIS_KEY, REDIS_TTL_SECONDS, JSON.stringify(result));
  } catch {
    // best-effort
  }
  return result;
}

export async function invalidateZobianOfMonthCache(): Promise<void> {
  memDel(MEM_KEY);
  try {
    await redis.del(REDIS_KEY);
  } catch {
    // best-effort
  }
}

/**
 * Auto-compute the current month's Zobian of the Month from XP gained THIS
 * calendar month (sum of xp_events.xp_awarded, top 1 user), and upsert it —
 * but never overwrite a row an admin has already flagged is_admin_override.
 * Called by /api/cron/feed-refresh; a no-op when
 * homeFeed.zobianOfMonthAutoComputeEnabled is off (caller checks that).
 */
export async function autoComputeZobianOfMonth(): Promise<{ computed: boolean; userId: string | null }> {
  const db = await getDb();

  const [existing] = await db
    .select({ isAdminOverride: schema.zobianOfMonth.isAdminOverride })
    .from(schema.zobianOfMonth)
    .where(eq(schema.zobianOfMonth.month, sql`date_trunc('month', NOW())::date`))
    .limit(1);
  if (existing?.isAdminOverride) {
    return { computed: false, userId: null }; // admin override wins — never overwrite
  }

  const [top] = await db
    .select({
      userId: schema.xpEvents.userId,
      xpGained: sql<string>`SUM(${schema.xpEvents.xpAwarded})::text`,
    })
    .from(schema.xpEvents)
    .where(
      sql`${schema.xpEvents.createdAt} >= date_trunc('month', NOW()) AND ${schema.xpEvents.createdAt} < date_trunc('month', NOW()) + INTERVAL '1 month'`
    )
    .groupBy(schema.xpEvents.userId)
    .orderBy(desc(sql`SUM(${schema.xpEvents.xpAwarded})`))
    .limit(1);
  if (!top) return { computed: false, userId: null };

  await db
    .insert(schema.zobianOfMonth)
    .values({
      month: sql`date_trunc('month', NOW())::date`,
      userId: top.userId,
      score: top.xpGained,
      isAdminOverride: false,
    })
    .onConflictDoUpdate({
      target: schema.zobianOfMonth.month,
      set: {
        userId: top.userId,
        score: top.xpGained,
        updatedAt: new Date(),
      },
      where: eq(schema.zobianOfMonth.isAdminOverride, false),
    });

  await invalidateZobianOfMonthCache();
  return { computed: true, userId: top.userId };
}
