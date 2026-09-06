export const dynamic = "force-dynamic";

/**
 * app/api/forum/threads/[slug]/posts/route.ts
 *
 * POST /api/forum/threads/[slug]/posts — reply to a thread (auth required).
 * Delegates eligibility, content moderation, image-cost charging, and pot
 * claim payout to lib/bbforum/service.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { createReply } from "@/lib/bbforum/service";

const createSchema = z.object({
  body: z.string().min(2).max(20000),
  contentFormat: z.enum(["plaintext", "markdown"]).default("plaintext"),
  imageUrl: z.string().url().max(1000).optional(),
  quotedPostId: z.string().uuid().optional(),
});

export const POST = withAuth(async (req: NextRequest, { params, auth }: { params: Promise<{ slug: string }>; auth: { user: { sub: string } } }) => {
  try {
    await requireFeatureEnabled("bbforum");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.forumWrite);
    const { slug } = await params;

    const body = await validateBody(req, createSchema);
    const { post, potClaimedCredits } = await createReply({
      userId: auth.user.sub,
      threadSlug: slug,
      body: body.body,
      contentFormat: body.contentFormat,
      imageUrl: body.imageUrl ?? null,
      quotedPostId: body.quotedPostId ?? null,
    });
    return NextResponse.json({ success: true, data: { post, potClaimedCredits }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
