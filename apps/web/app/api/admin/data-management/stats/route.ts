export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/data-management/stats?tab=users|financial|statistical&live=1
 *
 * Quick-stat cards for the /gate44/data-management admin utility.
 *
 * Cached in Redis for 30 minutes (lib/admin/statsCache.ts) — pass `live=1`
 * to bypass the cache and force a fresh computation (the "Refresh live
 * data" button). No live-updating stats: this is a request/response
 * endpoint, never polled.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { writeAuditLog } from "@/lib/audit/auditLog";
import { getCachedStats } from "@/lib/admin/statsCache";
import { getCoinEconomy, getRevenueByProvider, getPayoutSummary } from "@/lib/admin/financialStats";

const querySchema = z.object({
  tab: z.enum(["users", "financial", "statistical"]),
  live: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Users tab
// ---------------------------------------------------------------------------

interface UsersStatsRow {
  total_users: string;
  verified_count: string;
  banned_count: string;
  suspended_count: string;
  admin_or_mod_count: string;
  new_today: string;
  new_this_week: string;
  avg_trust_score: string | null;
  avg_xp_total: string | null;
}

async function computeUsersStats() {
  const { rows } = await db.query<UsersStatsRow>(
    `SELECT
       COUNT(*)::TEXT AS total_users,
       COUNT(*) FILTER (WHERE is_verified)::TEXT AS verified_count,
       COUNT(*) FILTER (WHERE is_banned)::TEXT AS banned_count,
       COUNT(*) FILTER (WHERE is_suspended)::TEXT AS suspended_count,
       COUNT(*) FILTER (WHERE is_admin OR is_moderator)::TEXT AS admin_or_mod_count,
       COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::TEXT AS new_today,
       COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')::TEXT AS new_this_week,
       AVG(trust_score)::TEXT AS avg_trust_score,
       AVG(xp_total)::TEXT AS avg_xp_total
     FROM users
     WHERE deleted_at IS NULL`
  );
  const row = rows[0];
  const num = (s: string | null | undefined) => Number(s ?? "0");
  return {
    totalUsers: num(row?.total_users),
    verifiedCount: num(row?.verified_count),
    bannedCount: num(row?.banned_count),
    suspendedCount: num(row?.suspended_count),
    adminOrModCount: num(row?.admin_or_mod_count),
    newToday: num(row?.new_today),
    newThisWeek: num(row?.new_this_week),
    avgTrustScore: row?.avg_trust_score ? Math.round(Number(row.avg_trust_score) * 10) / 10 : 0,
    avgXpTotal: row?.avg_xp_total ? Math.round(Number(row.avg_xp_total)) : 0,
  };
}

// ---------------------------------------------------------------------------
// Financial tab — reuses the same helpers as /api/admin/financial
// ---------------------------------------------------------------------------

async function computeFinancialStats() {
  const [coinEconomy, revenueByProvider, payoutSummary] = await Promise.all([
    getCoinEconomy(),
    getRevenueByProvider(),
    getPayoutSummary(),
  ]);
  return { coinEconomy, revenueByProvider, payoutSummary };
}

// ---------------------------------------------------------------------------
// Statistical tab
// ---------------------------------------------------------------------------

/** Best-effort COUNT(*) against a table that may not exist in every deployment. */
async function safeCount(sql: string): Promise<number> {
  try {
    const { rows } = await db.query<{ count: string }>(sql);
    return Number(rows[0]?.count ?? "0");
  } catch {
    return 0;
  }
}

async function computeStatisticalStats() {
  const [
    totalRooms,
    totalMessages,
    totalGuilds,
    totalForumThreads,
    totalForumPosts,
    totalBbThreads,
    totalBbPosts,
    totalPolls,
    totalQuizzes,
    totalTweets,
  ] = await Promise.all([
    safeCount(`SELECT COUNT(*)::TEXT AS count FROM rooms`),
    safeCount(`SELECT COUNT(*)::TEXT AS count FROM room_messages`),
    safeCount(`SELECT COUNT(*)::TEXT AS count FROM guilds`),
    safeCount(`SELECT COUNT(*)::TEXT AS count FROM forum_questions`),
    safeCount(`SELECT COUNT(*)::TEXT AS count FROM forum_answers`),
    safeCount(`SELECT COUNT(*)::TEXT AS count FROM bb_threads`),
    safeCount(`SELECT COUNT(*)::TEXT AS count FROM bb_posts`),
    safeCount(`SELECT COUNT(*)::TEXT AS count FROM polls`),
    safeCount(`SELECT COUNT(*)::TEXT AS count FROM quizzes`),
    safeCount(`SELECT COUNT(*)::TEXT AS count FROM tweets`),
  ]);

  return {
    totalRooms,
    totalMessages,
    totalGuilds,
    // Combines the Q&A forum (forum_questions/forum_answers) and the
    // bulletin-board forum (bb_threads/bb_posts, migration 0032) into one
    // "threads/posts" pair for the stat card.
    totalForumThreads: totalForumThreads + totalBbThreads,
    totalForumPosts: totalForumPosts + totalBbPosts,
    totalPolls,
    totalQuizzes,
    totalTweets,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { searchParams } = new URL(req.url);
    const { tab, live } = validateSearchParams(searchParams, querySchema);
    const isLive = live === "1" || live === "true";

    let result;
    if (tab === "users") {
      result = await getCachedStats("users", computeUsersStats, { live: isLive });
    } else if (tab === "financial") {
      result = await getCachedStats("financial", computeFinancialStats, { live: isLive });
    } else if (tab === "statistical") {
      result = await getCachedStats("statistical", computeStatisticalStats, { live: isLive });
    } else {
      throw badRequest("Invalid tab");
    }

    writeAuditLog({
      actorId: auth.user.sub,
      action: "data_management_stats_read",
      metadata: { tab, live: isLive },
    });

    return NextResponse.json(
      { tab, data: result.data, cachedAt: result.cachedAt, isLive: result.isLive },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
