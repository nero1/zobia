export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/posts/[postSlug]/share/route.ts
 *
 * POST — records that the caller shared this post (idempotent per user) and
 * attempts a reward-pot claim if the post has an active treasury. Called by
 * the public post page's Share button (components/blogs/PostActions.tsx).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug, getBlogPostBySlug } from "@/lib/blogs/repo";
import { recordShare } from "@/lib/blogs/service";

export const POST = withAuth<{ slug: string; postSlug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogVote);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const post = await getBlogPostBySlug(blog.id, params.postSlug);
    if (!post) throw notFound("Post not found");

    const result = await recordShare(post.id, auth.user.sub);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
