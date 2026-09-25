export const dynamic = 'force-dynamic';

/**
 * app/api/ads/boostable/route.ts
 *
 * GET /api/ads/boostable?contentType=X&contentId=Y
 *
 * Eligibility check for the generic content-boost flow (see
 * POST /api/content/boost, lib/ads/repo.ts createContentBoostCampaign) —
 * lets the client show/hide a "Boost" button and pre-flight ownership before
 * opening the boost flow, without actually creating a draft campaign.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/lib/db/drizzle";
import { and, eq, isNull } from "drizzle-orm";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { requireFeatureEnabled } from "@/lib/manifest";
import { checkAdvertiserEligibility } from "@/lib/ads/limits";
import { getBoostableContentSummary } from "@/lib/ads/repo";

const BOOSTABLE_TYPES = [
  "moment", "tweet", "blog_post", "forum_thread", "forum_question",
  "room", "wiki_page", "game", "classroom", "business_page_post",
  "poll", "quiz",
] as const;

const querySchema = z.object({
  contentType: z.enum(BOOSTABLE_TYPES),
  contentId: z.string().uuid(),
});

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await requireFeatureEnabled("adsSystem");

    const parsed = querySchema.safeParse({
      contentType: req.nextUrl.searchParams.get("contentType"),
      contentId: req.nextUrl.searchParams.get("contentId"),
    });
    if (!parsed.success) throw badRequest("contentType and contentId (uuid) are required", "INVALID_QUERY");

    const content = await getBoostableContentSummary(parsed.data.contentType, parsed.data.contentId);
    if (!content) {
      return NextResponse.json({ success: true, data: { boostable: false, reason: "Content not found" }, error: null });
    }

    const orm = await getDb();
    const callerRows = await orm
      .select({ isAdmin: schema.users.isAdmin, isModerator: schema.users.isModerator })
      .from(schema.users)
      .where(and(eq(schema.users.id, auth.user.sub), isNull(schema.users.deletedAt)))
      .limit(1);
    const isStaff = !!(callerRows[0]?.isAdmin || callerRows[0]?.isModerator);
    const ownsContent = content.ownerId === auth.user.sub;

    if (!ownsContent && !isStaff) {
      return NextResponse.json({ success: true, data: { boostable: false, reason: "You can only boost content you own." }, error: null });
    }

    const eligibility = isStaff ? { eligible: true, reason: null } : await checkAdvertiserEligibility(auth.user.sub);
    return NextResponse.json({
      success: true,
      data: {
        boostable: eligibility.eligible,
        reason: eligibility.eligible ? null : eligibility.reason,
        isInHouse: isStaff,
        preview: { title: content.title, body: content.body, imageUrl: content.imageUrl },
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
