export const dynamic = 'force-dynamic';

/**
 * app/api/business/ads/stats/route.ts
 *
 * GET /api/business/ads/stats — advertiser-facing ad performance, depth
 * gated by business tier exactly like /api/business/pages/stats
 * (lib/business/limits.ts getBusinessStatsTier): starter = totals only,
 * growth = totals + per-campaign breakdown, enterprise = + 90-day daily
 * drill-down (CSV export via /stats/export, Enterprise only).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth, type AuthContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBusinessStatsTier } from "@/lib/business/limits";
import { getCampaignTotals, getCampaignDailyStats } from "@/lib/ads/repo";

export const GET = withAuth(async (_req: NextRequest, { auth }: { auth: AuthContext }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    // A personal advertiser (no Business Account) gets the same stats depth
    // as a "starter" business tier — totals only, no per-campaign breakdown.
    const { rows } = await db.query<{ tier: string | null }>(
      `SELECT tier FROM business_accounts WHERE user_id = $1 LIMIT 1`,
      [auth.user.sub]
    );
    const tier = getBusinessStatsTier(rows[0]?.tier ?? "starter");
    const totals = await getCampaignTotals(auth.user.sub);
    const data: Record<string, unknown> = { tier, totals };

    if (tier === "more" || tier === "detailed" || tier === "detailed_export") {
      const { rows: campaigns } = await db.query<{ id: string; name: string; status: string; spent_credits: string; total_budget_credits: string }>(
        `SELECT id, name, status, spent_credits, total_budget_credits FROM ad_campaigns
         WHERE created_by = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
        [auth.user.sub]
      );
      data.campaignBreakdown = campaigns;
    }
    if (tier === "detailed" || tier === "detailed_export") {
      const { rows: campaignIds } = await db.query<{ id: string }>(
        `SELECT id FROM ad_campaigns WHERE created_by = $1 AND deleted_at IS NULL`,
        [auth.user.sub]
      );
      const dailyByCampaign: Record<string, unknown> = {};
      for (const c of campaignIds) {
        dailyByCampaign[c.id] = await getCampaignDailyStats(c.id, 90);
      }
      data.dailyStats = dailyByCampaign;
    }
    data.canExport = tier === "detailed_export";

    return NextResponse.json({ success: true, data, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
