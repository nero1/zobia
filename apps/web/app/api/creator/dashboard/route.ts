export const dynamic = 'force-dynamic';

/**
 * app/api/creator/dashboard/route.ts
 *
 * GET /api/creator/dashboard
 *
 * Returns a comprehensive creator dashboard payload:
 *  - revenue: today, week, month, allTime, broken down by stream
 *  - members: total, active (7-day), churnRate, avgSessionTime
 *  - topGifters: top 5 by lifetime coin gifts
 *  - questPerformance: sponsored quest completion stats
 *  - payoutHistory: last 10 payouts
 *  - roomHealthScore: average health score across creator's rooms
 *
 * Requires the caller to have is_creator = TRUE.
 * Results are cached in Redis for 60 seconds per creator.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { eq, and, isNull } from "drizzle-orm";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { redis } from "@/lib/redis";
import { memGet, memSet } from "@/lib/cache/memory";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL = 60; // seconds

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface RevenueRow {
  source_type: string;
  total_kobo: number;
}

interface MemberStatsRow {
  total_members: number;
  active_members_7d: number;
}

interface TopGifterRow {
  user_id: string;
  username: string;
  display_name: string;
  avatar_emoji: string;
  total_coins: number;
}

interface PayoutRow {
  id: string;
  amount_kobo: number;
  status: string;
  provider: string;
  created_at: string;
  processed_at: string | null;
}

interface QuestRow {
  completed: number;
  pending: number;
}

interface RoomHealthRow {
  avg_health: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Estimate average session time in minutes from room_messages activity.
 * Groups messages by user+room+day into "sessions" and computes avg gap.
 */
async function fetchAvgSessionTimeMinutes(creatorId: string): Promise<number | null> {
  try {
    const orm = await getDb();
    const { rows } = await orm.execute<{ avg_minutes: string } & Record<string, unknown>>(sql`
       WITH session_bounds AS (
         SELECT
           rm.sender_id,
           rm.room_id,
           DATE(rm.created_at) AS session_date,
           MIN(rm.created_at) AS session_start,
           MAX(rm.created_at) AS session_end,
           EXTRACT(EPOCH FROM (MAX(rm.created_at) - MIN(rm.created_at))) / 60 AS duration_minutes
         FROM room_messages rm
         JOIN rooms r ON r.id = rm.room_id
         WHERE r.creator_id = ${creatorId}
           AND rm.created_at >= NOW() - INTERVAL '30 days'
           AND rm.deleted_at IS NULL
         GROUP BY rm.sender_id, rm.room_id, DATE(rm.created_at)
         HAVING COUNT(*) >= 2
       )
       SELECT ROUND(AVG(duration_minutes))::TEXT AS avg_minutes
       FROM session_bounds
    `);
    const val = rows[0]?.avg_minutes;
    if (!val) return null;
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * Build revenue summary by stream for a given time window.
 *
 * @param creatorId - Creator UUID
 * @param since     - ISO timestamp for window start (or null for all time)
 * @returns Record of source_type to total_kobo
 */
async function fetchRevenueByStream(
  creatorId: string,
  since: string | null
): Promise<Record<string, number>> {
  const orm = await getDb();
  const whereClause = since
    ? sql`creator_id = ${creatorId} AND created_at >= ${since}`
    : sql`creator_id = ${creatorId}`;

  const { rows } = await orm.execute<RevenueRow & Record<string, unknown>>(sql`
     SELECT source_type, SUM(net_amount_kobo)::int AS total_kobo
     FROM creator_earnings
     WHERE ${whereClause}
     GROUP BY source_type
  `);

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.source_type] = row.total_kobo;
  }
  return result;
}

// ---------------------------------------------------------------------------
// GET /api/creator/dashboard
// ---------------------------------------------------------------------------

/**
 * Return the full creator dashboard data payload.
 *
 * @param req - Incoming request
 * @returns Dashboard payload with revenue, members, gifters, payouts, health
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const creatorId = auth.user.sub;

    // Verify creator status
    const orm = await getDb();
    const [userRow] = await orm
      .select({ is_creator: schema.users.isCreator })
      .from(schema.users)
      .where(and(eq(schema.users.id, creatorId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!userRow?.is_creator) {
      throw forbidden("Creator account required to access the dashboard");
    }

    // Check cache — memory first (15s), then Redis (60s)
    const cacheKey = `creator:dashboard:${creatorId}`;
    const memCached = memGet<object>(cacheKey);
    if (memCached) return NextResponse.json(memCached, { status: 200 });
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as object;
        memSet(cacheKey, parsed, 15_000);
        return NextResponse.json(parsed, { status: 200 });
      }
    } catch {
      // Cache miss
    }

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);

    const monthStart = new Date(now);
    monthStart.setDate(now.getDate() - 30);

    // Revenue breakdown by stream (+ avg session time in parallel)
    const [todayRevenue, weekRevenue, monthRevenue, allTimeRevenue, avgSessionTime] =
      await Promise.all([
        fetchRevenueByStream(creatorId, todayStart.toISOString()),
        fetchRevenueByStream(creatorId, weekStart.toISOString()),
        fetchRevenueByStream(creatorId, monthStart.toISOString()),
        fetchRevenueByStream(creatorId, null),
        fetchAvgSessionTimeMinutes(creatorId),
      ]);

    const sumRevenue = (map: Record<string, number>) =>
      Object.values(map).reduce((a, b) => a + b, 0);

    // Member stats across all creator rooms
    const { rows: memberRows } = await orm.execute<MemberStatsRow & Record<string, unknown>>(sql`
       SELECT
         SUM(r.member_count)::int               AS total_members,
         (SELECT COUNT(DISTINCT rm2.user_id)::int
          FROM room_members rm2
          JOIN rooms r2 ON r2.id = rm2.room_id
          JOIN room_messages m2 ON m2.sender_id = rm2.user_id AND m2.room_id = r2.id
          WHERE r2.creator_id = ${creatorId}
            AND m2.created_at > NOW() - INTERVAL '7 days')
         AS active_members_7d
       FROM rooms r
       WHERE r.creator_id = ${creatorId} AND r.is_active = TRUE
    `);

    const memberStats = memberRows[0] ?? { total_members: 0, active_members_7d: 0 };

    const churnRate =
      memberStats.total_members > 0
        ? Math.round(
            ((memberStats.total_members - memberStats.active_members_7d) /
              memberStats.total_members) *
              100
          )
        : 0;

    // Top 5 gifters (lifetime)
    const { rows: topGifters } = await orm.execute<TopGifterRow & Record<string, unknown>>(sql`
       SELECT
         g.sender_id   AS user_id,
         u.username,
         u.display_name,
         u.avatar_emoji,
         SUM(g.coin_value)::int AS total_coins
       FROM gifts g
       JOIN rooms r ON r.id = g.room_id
       JOIN users u ON u.id = g.sender_id
       WHERE r.creator_id = ${creatorId}
       GROUP BY g.sender_id, u.username, u.display_name, u.avatar_emoji
       ORDER BY total_coins DESC
       LIMIT 5
    `);

    // Quest performance (sponsored quests)
    const { rows: questRows } = await orm.execute<QuestRow & Record<string, unknown>>(sql`
       SELECT
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE status = 'pending')::int   AS pending
       FROM sponsored_quests
       WHERE creator_id = ${creatorId}
    `);
    const questPerformance = questRows[0] ?? { completed: 0, pending: 0 };

    // Payout history (last 10)
    const { rows: payouts } = await orm.execute<PayoutRow & Record<string, unknown>>(sql`
       SELECT id, amount_kobo, status, provider, created_at, processed_at
       FROM creator_payouts
       WHERE creator_id = ${creatorId}
       ORDER BY created_at DESC
       LIMIT 10
    `);

    // Average room health score
    const { rows: healthRows } = await orm.execute<RoomHealthRow & Record<string, unknown>>(sql`
       SELECT COALESCE(AVG(health_score), 100)::int AS avg_health
       FROM rooms
       WHERE creator_id = ${creatorId} AND is_active = TRUE
    `);
    const roomHealthScore = healthRows[0]?.avg_health ?? 100;

    const dashboard = {
      // The web/(app)/creator/page.tsx client (and the Android dashboard) both
      // gate on this flag. Anyone reaching this point already passed the
      // is_creator check above, so it's always true here — added because the
      // client-side check was previously reading an always-undefined field
      // and silently redirecting real creators away from their own dashboard.
      isCreator: true,
      revenue: {
        today: sumRevenue(todayRevenue),
        week: sumRevenue(weekRevenue),
        month: sumRevenue(monthRevenue),
        allTime: sumRevenue(allTimeRevenue),
        byStream: {
          gift: allTimeRevenue.gift ?? 0,
          subscription: allTimeRevenue.subscription ?? 0,
          dropEntry: allTimeRevenue.drop_entry ?? 0,
          classroomEnrolment: allTimeRevenue.classroom_enrolment ?? 0,
          sponsoredQuest: allTimeRevenue.sponsored_quest ?? 0,
          merch: allTimeRevenue.merch ?? 0,
          creatorFund: allTimeRevenue.creator_fund ?? 0,
        },
      },
      members: {
        total: memberStats.total_members,
        active: memberStats.active_members_7d,
        churnRate,
        avgSessionTime,
      },
      topGifters,
      questPerformance,
      payoutHistory: payouts,
      roomHealthScore,
    };

    // Cache result — memory (15s) + Redis (60s)
    memSet(cacheKey, dashboard, 15_000);
    try {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(dashboard));
    } catch {
      // Ignore cache write failures
    }

    return NextResponse.json(dashboard, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
