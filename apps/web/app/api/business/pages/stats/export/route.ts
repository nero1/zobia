export const dynamic = 'force-dynamic';

/**
 * app/api/business/pages/stats/export/route.ts
 *
 * GET /api/business/pages/stats/export — CSV download of the 90-day daily
 * stats drill-down. Enterprise tier only (mirrors blogs stats/export).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { isUserModeratorOrAdmin } from "@/lib/forum/service";
import { getBusinessStatsTier } from "@/lib/business/limits";
import { getBusinessDailyStats } from "@/lib/business/repo";

function toCsv(rows: Awaited<ReturnType<typeof getBusinessDailyStats>>): string {
  const header = "date,page_name,views,post_views,ad_impressions,ad_clicks";
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [r.date, escape(r.page_name), r.views, r.post_views, r.ad_impressions, r.ad_clicks].join(","));
  return [header, ...lines].join("\n");
}

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
      throw forbidden("Only the account owner or a moderator can export stats.");
    }

    const tier = getBusinessStatsTier(account.tier);
    if (tier !== "detailed_export") {
      throw forbidden("Exporting stats requires the Enterprise tier.", "BUSINESS_STATS_EXPORT_REQUIRES_UPGRADE");
    }

    const daily = await getBusinessDailyStats(account.id, 90);
    const csv = toCsv(daily);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="business-ads-stats.csv"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
