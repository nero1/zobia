export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/subscribe/route.ts
 *
 * POST   — subscribe to get notified of new posts on this blog
 * DELETE — unsubscribe
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug } from "@/lib/blogs/repo";
import { toggleSubscription } from "@/lib/blogs/service";

export const POST = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogVote);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const result = await toggleSubscription(blog.id, auth.user.sub, true);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogVote);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const result = await toggleSubscription(blog.id, auth.user.sub, false);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
