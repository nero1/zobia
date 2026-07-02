export const dynamic = 'force-dynamic';

/**
 * app/api/business/ads/campaigns/[campaignId]/submit/route.ts
 *
 * POST /api/business/ads/campaigns/:campaignId/submit — send a draft
 * campaign (with at least one creative and a funded budget) into
 * moderation. Mirrors app/api/business/sponsored-quests's AI/manual review
 * split (lib/ads/repo.ts submitCampaignForModeration).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth, type AuthContext } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getOwnBusinessAccountId } from "@/lib/ads/limits";
import { getOwnCampaign, listCreatives, submitCampaignForModeration } from "@/lib/ads/repo";
import { logger } from "@/lib/logger";

interface Ctx {
  params: Promise<{ campaignId: string }>;
  auth: AuthContext;
}

export const POST = withAuth(async (_req: NextRequest, { params, auth }: Ctx) => {
  try {
    await requireFeatureEnabled("adsSystem");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { campaignId } = await params;

    const businessAccountId = await getOwnBusinessAccountId(auth.user.sub);
    if (!businessAccountId) throw notFound("Business account not found");

    const campaign = await getOwnCampaign(campaignId, businessAccountId);
    if (!campaign) throw notFound("Campaign not found");
    if (campaign.status !== "draft") throw badRequest(`Campaign is already ${campaign.status}.`);

    const creatives = await listCreatives(campaignId);
    if (creatives.length === 0) throw badRequest("Add at least one creative before submitting.");
    if (Number(campaign.total_budget_credits) <= 0) throw badRequest("Fund the campaign budget before submitting.");

    const { rows: pageRows } = await db.query<{ business_name: string }>(
      `SELECT business_name FROM business_accounts WHERE id = $1 LIMIT 1`,
      [businessAccountId]
    );
    const advertiserName = pageRows[0]?.business_name ?? "Advertiser";

    const { moderationStatus, reason } = await submitCampaignForModeration(campaign, advertiserName);

    if (moderationStatus === "pending") {
      await db
        .query(
          `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
           VALUES ('ad_campaign_pending_review', 'info', $1, $2::jsonb, NOW())`,
          [
            `Advertiser "${advertiserName}" submitted an ad campaign ("${campaign.name}") pending moderation.`,
            JSON.stringify({ campaignId, businessAccountId }),
          ]
        )
        .catch((err) => logger.error({ err }, "[business/ads/submit] failed to write system_alert"));
    }

    return NextResponse.json({ success: true, data: { campaignId, moderationStatus, reason }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
