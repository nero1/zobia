export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/posts/[postSlug]/treasury/route.ts
 *
 * GET  — public: the post's reward-pot state (or null if none), so the
 *        article page can show a "Reward pot" badge.
 * POST — post author only: fund (or top up) the reward pot.
 *        { amount: number (Credits), maxClaimants: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug, getBlogPostBySlug } from "@/lib/blogs/repo";
import { fundPostTreasury, getPostTreasury } from "@/lib/blogs/service";

const fundSchema = z.object({
  amount: z.number().int().min(1).max(1_000_000),
  maxClaimants: z.number().int().min(1).max(10_000),
});

async function resolvePost(blogSlug: string, postSlug: string) {
  const blog = await getBlogBySlug(blogSlug);
  if (!blog) throw notFound("Blog not found");
  const post = await getBlogPostBySlug(blog.id, postSlug);
  if (!post) throw notFound("Post not found");
  return post;
}

export const GET = withAuth<{ slug: string; postSlug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const post = await resolvePost(params.slug, params.postSlug);
    const treasury = await getPostTreasury(post.id);
    return NextResponse.json({ success: true, data: { treasury }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ slug: string; postSlug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogWrite);
    const post = await resolvePost(params.slug, params.postSlug);
    const body = await validateBody(req, fundSchema);
    const treasury = await fundPostTreasury(auth.user.sub, post.id, body.amount, body.maxClaimants);
    return NextResponse.json({ success: true, data: { treasury }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
