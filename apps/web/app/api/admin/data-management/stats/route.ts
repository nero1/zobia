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
import { isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

async function computeUsersStats() {
  const orm = await getDb();
  const u = schema.users;
  const [row] = await orm
    .select({
      total_users: sql<string>`COUNT(*)::TEXT`,
      verified_count: sql<string>`COUNT(*) FILTER (WHERE ${u.isVerified})::TEXT`,
      banned_count: sql<string>`COUNT(*) FILTER (WHERE ${u.isBanned})::TEXT`,
      suspended_count: sql<string>`COUNT(*) FILTER (WHERE ${u.isSuspended})::TEXT`,
      admin_or_mod_count: sql<string>`COUNT(*) FILTER (WHERE ${u.isAdmin} OR ${u.isModerator})::TEXT`,
      new_today: sql<string>`COUNT(*) FILTER (WHERE ${u.createdAt} >= CURRENT_DATE)::TEXT`,
      new_this_week: sql<string>`COUNT(*) FILTER (WHERE ${u.createdAt} >= CURRENT_DATE - INTERVAL '7 days')::TEXT`,
      avg_trust_score: sql<string | null>`AVG(${u.trustScore})::TEXT`,
      avg_xp_total: sql<string | null>`AVG(${u.xpTotal})::TEXT`,
    })
    .from(u)
    .where(isNull(u.deletedAt));

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
async function safeCount(table: ReturnType<typeof sql>): Promise<number> {
  try {
    const orm = await getDb();
    const result = await orm.execute<{ count: string }>(sql`SELECT COUNT(*)::TEXT AS count FROM ${table}`);
    return Number(result.rows[0]?.count ?? "0");
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
    safeCount(sql`rooms`),
    safeCount(sql`room_messages`),
    safeCount(sql`guilds`),
    safeCount(sql`forum_questions`),
    safeCount(sql`forum_answers`),
    safeCount(sql`bb_threads`),
    safeCount(sql`bb_posts`),
    safeCount(sql`polls`),
    safeCount(sql`quizzes`),
    safeCount(sql`tweets`),
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
