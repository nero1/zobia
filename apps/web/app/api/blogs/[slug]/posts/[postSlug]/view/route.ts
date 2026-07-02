export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/posts/[postSlug]/view/route.ts
 *
 * POST — record one view. The client only calls this once per post per
 * session (deduped client-side via localStorage — see useBlogPostView),
 * so this stays a cheap single UPDATE + upsert, not a per-view DB row.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug, getBlogPostBySlug } from "@/lib/blogs/repo";
import { recordView } from "@/lib/blogs/service";

export const POST = withAuth<{ slug: string; postSlug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogVote);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const post = await getBlogPostBySlug(blog.id, params.postSlug);
    if (!post || post.status !== "published") throw notFound("Post not found");
    await recordView(post.id);
    return NextResponse.json({ success: true, data: { recorded: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
