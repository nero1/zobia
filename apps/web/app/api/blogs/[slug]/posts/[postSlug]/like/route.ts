export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/posts/[postSlug]/like/route.ts
 *
 * POST   — like the post
 * DELETE — unlike the post
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug, getBlogPostBySlug } from "@/lib/blogs/repo";
import { toggleLike } from "@/lib/blogs/service";

async function resolvePost(blogSlug: string, postSlug: string) {
  const blog = await getBlogBySlug(blogSlug);
  if (!blog) throw notFound("Blog not found");
  const post = await getBlogPostBySlug(blog.id, postSlug);
  if (!post) throw notFound("Post not found");
  return post;
}

export const POST = withAuth<{ slug: string; postSlug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogVote);
    const post = await resolvePost(params.slug, params.postSlug);
    const result = await toggleLike(post.id, auth.user.sub, true);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ slug: string; postSlug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogVote);
    const post = await resolvePost(params.slug, params.postSlug);
    const result = await toggleLike(post.id, auth.user.sub, false);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
