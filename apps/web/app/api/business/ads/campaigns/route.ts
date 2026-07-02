export const dynamic = 'force-dynamic';

/**
 * app/api/business/ads/campaigns/route.ts
 *
 * Business self-service ad campaigns (PRD §17 Pillar 3 — Platform
 * Advertising). Requires a verified Business Account whose owner holds at
 * least `ad_min_kyc_tier_to_advertise` (default 1) — see
 * lib/ads/limits.ts checkAdvertiserEligibility. Mirrors the Sponsored Quest
 * self-service submission pattern (app/api/business/sponsored-quests).
 *
 * GET  /api/business/ads/campaigns — list the caller's own campaigns.
 * POST /api/business/ads/campaigns — create a new draft campaign.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { checkAdvertiserEligibility, getOwnBusinessAccountId } from "@/lib/ads/limits";
import { createCampaign, listOwnCampaigns } from "@/lib/ads/repo";

const createSchema = z.object({
  businessPageId: z.string().uuid().nullable().optional(),
  name: z.string().min(3).max(150),
  objective: z.enum(["awareness", "traffic", "boost_post", "boost_room"]).default("traffic"),
  targetPlans: z.array(z.enum(["free", "plus", "pro", "max"])).max(4).optional(),
  boostedContentType: z.enum(["blog_post", "room"]).optional(),
  boostedContentId: z.string().uuid().optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
});

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("adsSystem");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const businessAccountId = await getOwnBusinessAccountId(auth.user.sub);
    if (!businessAccountId) throw notFound("Business account not found");

    const campaigns = await listOwnCampaigns(businessAccountId);
    return NextResponse.json({ success: true, data: { campaigns }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("adsSystem");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const eligibility = await checkAdvertiserEligibility(auth.user.sub);
    if (!eligibility.eligible || !eligibility.businessAccountId) {
      throw forbidden(eligibility.reason ?? "You are not eligible to place ads.", "AD_ADVERTISER_INELIGIBLE");
    }

    const body = await validateBody(req, createSchema);

    if (body.businessPageId) {
      const { rows: pageRows } = await db.query<{ id: string }>(
        `SELECT id FROM business_pages WHERE id = $1 AND business_account_id = $2 AND deleted_at IS NULL AND status = 'active' LIMIT 1`,
        [body.businessPageId, eligibility.businessAccountId]
      );
      if (!pageRows[0]) throw forbidden("businessPageId must reference one of your active Business Pages");
    }

    const campaign = await createCampaign({
      businessAccountId: eligibility.businessAccountId,
      businessPageId: body.businessPageId ?? null,
      createdBy: auth.user.sub,
      name: body.name,
      objective: body.objective,
      targetPlans: body.targetPlans ?? null,
      boostedContentType: body.boostedContentType ?? null,
      boostedContentId: body.boostedContentId ?? null,
      startAt: body.startAt ?? null,
      endAt: body.endAt ?? null,
    });

    return NextResponse.json({ success: true, data: { campaign }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
