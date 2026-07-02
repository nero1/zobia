export const dynamic = 'force-dynamic';

/**
 * app/api/business/pages/stats/route.ts
 *
 * GET /api/business/pages/stats — account owner/moderator/admin analytics,
 * depth gated by the business account's tier (PRD §17 "Depth and breadth of
 * page and advert stats increases with biz account tier"), mirroring the
 * Blogs stats tiers exactly (lib/blogs/limits.ts STATS_TIER):
 *   starter    -> totals only
 *   growth     -> totals + per-page breakdown
 *   enterprise -> totals + per-page breakdown + 90-day daily drill-down
 *                 (export available via /stats/export, Enterprise only)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { isUserModeratorOrAdmin } from "@/lib/forum/service";
import { getBusinessStatsTier } from "@/lib/business/limits";
import { getBusinessStatsTotals, getBusinessPageStatsBreakdown, getBusinessDailyStats } from "@/lib/business/repo";

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { rows } = await db.query<{ id: string; tier: string; user_id: string }>(
      `SELECT id, tier, user_id FROM business_accounts WHERE user_id = $1 LIMIT 1`,
      [auth.user.sub]
    );
    const account = rows[0];
    if (!account) throw notFound("Business account not found");

    if (account.user_id !== auth.user.sub && !(await isUserModeratorOrAdmin(auth.user.sub))) {
      throw forbidden("Only the account owner or a moderator can view stats.");
    }

    const tier = getBusinessStatsTier(account.tier);
    const totals = await getBusinessStatsTotals(account.id);
    const data: Record<string, unknown> = { tier, totals };

    if (tier === "more" || tier === "detailed" || tier === "detailed_export") {
      data.pageBreakdown = await getBusinessPageStatsBreakdown(account.id);
    }
    if (tier === "detailed" || tier === "detailed_export") {
      data.dailyStats = await getBusinessDailyStats(account.id, 90);
    }
    data.canExport = tier === "detailed_export";

    return NextResponse.json({ success: true, data, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
