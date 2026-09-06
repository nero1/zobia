export const dynamic = "force-dynamic";

/**
 * app/api/forum/posts/[id]/react/route.ts
 *
 * POST /api/forum/posts/[id]/react — toggle an emoji reaction on a post.
 * Posting the same emoji again removes it (matches the forum vote toggle
 * pattern in lib/forum/service.ts castVote).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { reactToPost } from "@/lib/bbforum/service";

const schema = z.object({ emoji: z.string().min(1).max(8) });

export const POST = withAuth(async (req: NextRequest, { params, auth }: { params: Promise<{ id: string }>; auth: { user: { sub: string } } }) => {
  try {
    await requireFeatureEnabled("bbforum");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.forumVote);
    const { id } = await params;
    const { emoji } = await validateBody(req, schema);
    const result = await reactToPost(id, auth.user.sub, emoji);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
