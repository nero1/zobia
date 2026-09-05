export const dynamic = 'force-dynamic';

/**
 * app/api/business/ads/campaigns/[campaignId]/route.ts
 *
 * GET   — fetch one of the caller's own campaigns (with creatives).
 * PATCH — start/pause/stop a campaign that has already cleared moderation.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody, type AuthContext } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";
import { getOwnCampaign, listCreatives, setCampaignRunState } from "@/lib/ads/repo";

interface Ctx {
  params: Promise<{ campaignId: string }>;
  auth: AuthContext;
}

const patchSchema = z.object({ action: z.enum(["activate", "pause", "stop"]) });

export const GET = withAuth(async (_req: NextRequest, { params, auth }: Ctx) => {
  try {
    await requireFeatureEnabled("adsSystem");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const { campaignId } = await params;

    const campaign = await getOwnCampaign(campaignId, auth.user.sub);
    if (!campaign) throw notFound("Campaign not found");

    const creatives = await listCreatives(campaignId);
    return NextResponse.json({ success: true, data: { campaign, creatives }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const PATCH = withAuth(async (req: NextRequest, { params, auth }: Ctx) => {
  try {
    await requireFeatureEnabled("adsSystem");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { campaignId } = await params;
    const body = await validateBody(req, patchSchema);

    const state = body.action === "activate" ? "active" : body.action === "pause" ? "paused" : "stopped";
    const campaign = await setCampaignRunState(campaignId, auth.user.sub, state);
    if (!campaign) throw badRequest("Campaign not found, or has not been approved yet.");

    // Activating with an empty (or fully-spent) budget is allowed — the
    // campaign just won't serve any impressions until the Ad Wallet is
    // funded (lib/ads/serve.ts gates on spent_credits < total_budget_credits).
    // Notify the advertiser so this isn't a silent no-op.
    if (state === "active" && Number(campaign.total_budget_credits) - Number(campaign.spent_credits) <= 0) {
      await db.query(
        `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
         VALUES ($1, 'ad_campaign_unfunded', 'Ad campaign needs funding',
                 $2, $3::jsonb, false, NOW())`,
        [
          auth.user.sub,
          `"${campaign.name}" is approved and active, but your Ad Wallet has no funds — it won't start running until you fund it.`,
          JSON.stringify({ campaignId: campaign.id }),
        ]
      ).catch(() => {});
    }

    return NextResponse.json({ success: true, data: { campaign }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
