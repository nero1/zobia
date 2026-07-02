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
import { getOwnBusinessAccountId } from "@/lib/ads/limits";
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

    const businessAccountId = await getOwnBusinessAccountId(auth.user.sub);
    if (!businessAccountId) throw notFound("Business account not found");

    const campaign = await getOwnCampaign(campaignId, businessAccountId);
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

    const businessAccountId = await getOwnBusinessAccountId(auth.user.sub);
    if (!businessAccountId) throw notFound("Business account not found");

    const state = body.action === "activate" ? "active" : body.action === "pause" ? "paused" : "stopped";
    const campaign = await setCampaignRunState(campaignId, businessAccountId, state);
    if (!campaign) throw badRequest("Campaign not found, or has not been approved yet.");

    return NextResponse.json({ success: true, data: { campaign }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
