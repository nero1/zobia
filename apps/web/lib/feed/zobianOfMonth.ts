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

import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { memGet, memSet, memDel } from "@/lib/cache/memory";

const MEM_KEY = "zobian_of_month:current";
const MEM_TTL_MS = 30_000;
const REDIS_KEY = "zobian_of_month:current:v1";
const REDIS_TTL_SECONDS = 300;

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

  const { rows } = await db.query<{
    month: string;
    user_id: string;
    username: string;
    display_name: string;
    avatar_emoji: string;
    avatar_url: string | null;
    score: string | null;
    is_admin_override: boolean;
    note: string | null;
  }>(
    `SELECT z.month, z.user_id, u.username, u.display_name, u.avatar_emoji, u.avatar_url,
            z.score, z.is_admin_override, z.note
     FROM zobian_of_month z
     JOIN users u ON u.id = z.user_id
     WHERE z.month = date_trunc('month', NOW())::date
     LIMIT 1`
  );
  const row = rows[0];
  const result: ZobianOfMonthPublic | null = row
    ? {
        month: row.month,
        userId: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatarEmoji: row.avatar_emoji,
        avatarUrl: row.avatar_url,
        score: row.score,
        isAdminOverride: row.is_admin_override,
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
  const { rows: existing } = await db.query<{ is_admin_override: boolean }>(
    `SELECT is_admin_override FROM zobian_of_month WHERE month = date_trunc('month', NOW())::date LIMIT 1`
  );
  if (existing[0]?.is_admin_override) {
    return { computed: false, userId: null }; // admin override wins — never overwrite
  }

  const { rows: topRows } = await db.query<{ user_id: string; xp_gained: string }>(
    `SELECT user_id, SUM(xp_awarded)::text AS xp_gained
     FROM xp_events
     WHERE created_at >= date_trunc('month', NOW()) AND created_at < date_trunc('month', NOW()) + INTERVAL '1 month'
     GROUP BY user_id
     ORDER BY SUM(xp_awarded) DESC
     LIMIT 1`
  );
  const top = topRows[0];
  if (!top) return { computed: false, userId: null };

  await db.query(
    `INSERT INTO zobian_of_month (month, user_id, score, is_admin_override)
     VALUES (date_trunc('month', NOW())::date, $1, $2, false)
     ON CONFLICT (month) DO UPDATE
       SET user_id = EXCLUDED.user_id, score = EXCLUDED.score, updated_at = NOW()
       WHERE zobian_of_month.is_admin_override = false`,
    [top.user_id, top.xp_gained]
  );
  await invalidateZobianOfMonthCache();
  return { computed: true, userId: top.user_id };
}
