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
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBusinessStatsTier } from "@/lib/business/limits";
import { getCampaignTotals, getCampaignDailyStats } from "@/lib/ads/repo";

export const GET = withAuth(async (_req: NextRequest, { auth }: { auth: AuthContext }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { rows } = await db.query<{ id: string; tier: string }>(
      `SELECT id, tier FROM business_accounts WHERE user_id = $1 LIMIT 1`,
      [auth.user.sub]
    );
    const account = rows[0];
    if (!account) throw notFound("Business account not found");

    const tier = getBusinessStatsTier(account.tier);
    const totals = await getCampaignTotals(account.id);
    const data: Record<string, unknown> = { tier, totals };

    if (tier === "more" || tier === "detailed" || tier === "detailed_export") {
      const { rows: campaigns } = await db.query<{ id: string; name: string; status: string; spent_credits: string; total_budget_credits: string }>(
        `SELECT id, name, status, spent_credits, total_budget_credits FROM ad_campaigns
         WHERE business_account_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
        [account.id]
      );
      data.campaignBreakdown = campaigns;
    }
    if (tier === "detailed" || tier === "detailed_export") {
      const { rows: campaignIds } = await db.query<{ id: string }>(
        `SELECT id FROM ad_campaigns WHERE business_account_id = $1 AND deleted_at IS NULL`,
        [account.id]
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
