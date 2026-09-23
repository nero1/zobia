export const dynamic = 'force-dynamic';

/**
 * app/api/content/boost/route.ts
 *
 * POST /api/content/boost — generic "boost any boostable content type"
 * entry point, per the product decision that boosts live entirely under the
 * existing Ads system as a sponsored-post ad objective (objective =
 * 'boost_content', boosted_content_type as the discriminator) rather than a
 * parallel boost feature. Reuses createContentBoostCampaign() +
 * submitCampaignForModeration() exactly as every other campaign type does —
 * same moderation queue, same CPM billing (lib/economy/adWallet.ts), same
 * admin approval queue at /gate44/ads.
 *
 * Auth: the caller must either own the content being boosted, or be an
 * admin/moderator (whose boosts are flagged in-house and ranked as tier 5 —
 * see lib/feed/ranking.ts — rather than tier 1 paid boosts).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, forbidden, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { checkAdvertiserEligibility } from "@/lib/ads/limits";
import {
  createContentBoostCampaign,
  getBoostableContentSummary,
  submitCampaignForModeration,
} from "@/lib/ads/repo";
import { deepLinkPathFor } from "@/lib/feed/deeplink";

const BOOSTABLE_TYPES = [
  "moment", "tweet", "blog_post", "forum_thread", "forum_question",
  "room", "wiki_page", "game", "classroom", "business_page_post",
  "poll", "quiz",
] as const;

const boostSchema = z.object({
  contentType: z.enum(BOOSTABLE_TYPES),
  contentId: z.string().uuid(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
  targetPlans: z.array(z.enum(["free", "plus", "pro", "max"])).max(4).optional(),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("adsSystem");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, boostSchema);

    const content = await getBoostableContentSummary(body.contentType, body.contentId);
    if (!content) throw notFound("Content not found");

    // Ownership check — the caller must own the content, or be admin/mod.
    const { rows: callerRows } = await db.query<{ is_admin: boolean; is_moderator: boolean }>(
      `SELECT is_admin, is_moderator FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [auth.user.sub]
    );
    const caller = callerRows[0];
    if (!caller) throw notFound("User not found");
    const isStaff = !!(caller.is_admin || caller.is_moderator);
    const ownsContent = content.ownerId === auth.user.sub;
    if (!ownsContent && !isStaff) {
      throw forbidden("You can only boost content you own.", "AD_NOT_CONTENT_OWNER");
    }

    // Determine whether the CONTENT AUTHOR (not necessarily the caller, for
    // an admin boosting someone else's content) is staff — that is what
    // makes the resulting campaign "in-house boosted" (ranking tier 5).
    let isInHouse = isStaff;
    if (!isInHouse && content.ownerId) {
      const { rows: authorRows } = await db.query<{ is_admin: boolean; is_moderator: boolean }>(
        `SELECT is_admin, is_moderator FROM users WHERE id = $1 LIMIT 1`,
        [content.ownerId]
      );
      isInHouse = !!(authorRows[0]?.is_admin || authorRows[0]?.is_moderator);
    }

    const eligibility = await checkAdvertiserEligibility(auth.user.sub);
    if (!isInHouse && !eligibility.eligible) {
      throw forbidden(eligibility.reason ?? "You are not eligible to place ads.", "AD_ADVERTISER_INELIGIBLE");
    }

    const advertiserType = eligibility.canAdvertiseAsBusiness ? "business_account" : "personal";
    const result = await createContentBoostCampaign({
      createdBy: auth.user.sub,
      businessAccountId: advertiserType === "business_account" ? (eligibility.businessAccountId ?? null) : null,
      businessPageId: null,
      advertiserType,
      boostedContentType: body.contentType,
      boostedContentId: body.contentId,
      targetPlans: body.targetPlans ?? null,
      startAt: body.startAt ?? null,
      endAt: body.endAt ?? null,
      clickUrl: deepLinkPathFor(body.contentType, body.contentId),
      isInHouse,
    });
    if (!result) throw notFound("Content not found");

    const { rows: nameRows } = await db.query<{ display_name: string }>(
      `SELECT display_name FROM users WHERE id = $1 LIMIT 1`,
      [auth.user.sub]
    );
    const moderation = await submitCampaignForModeration(result.campaign, nameRows[0]?.display_name ?? "Zobia user");

    return NextResponse.json(
      {
        success: true,
        data: {
          campaign: result.campaign,
          creative: result.creative,
          moderation,
        },
        error: null,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
