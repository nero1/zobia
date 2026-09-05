export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/posts/[postSlug]/reset-default/route.ts
 *
 * POST — "Reset to default" for one of the three auto-generated pages
 * (About/Privacy/Contact — migration 0023). 404s for any post that isn't
 * tagged with a page_key (i.e. an ordinary article/page an owner wrote).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug, getBlogPostBySlug } from "@/lib/blogs/repo";
import { resetDefaultPage, isUserModeratorOrAdmin } from "@/lib/blogs/service";
import type { DefaultPageKey } from "@/lib/blogs/defaultPages";

export const POST = withAuth<{ slug: string; postSlug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogWrite);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const post = await getBlogPostBySlug(blog.id, params.postSlug);
    if (!post) throw notFound("Post not found");
    if (!post.page_key) throw badRequest("This page has no default template to reset to.", "BLOG_PAGE_NOT_DEFAULT");

    const isMod = await isUserModeratorOrAdmin(auth.user.sub);
    await resetDefaultPage(blog.id, auth.user.sub, isMod, post.page_key as DefaultPageKey);
    return NextResponse.json({ success: true, data: { reset: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
