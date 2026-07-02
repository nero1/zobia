export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/posts/[postSlug]/comments/route.ts
 *
 * GET  — list visible comments (+ the caller's own pending comments, and
 *        all pending comments if the caller is the blog owner/moderator).
 * POST — add a comment (goes to 'pending' if the blog owner enabled moderation).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug, getBlogPostBySlug, listBlogComments } from "@/lib/blogs/repo";
import { addComment, isUserModeratorOrAdmin } from "@/lib/blogs/service";

const createSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  parentCommentId: z.string().uuid().optional().nullable(),
});

export const GET = withAuth<{ slug: string; postSlug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const post = await getBlogPostBySlug(blog.id, params.postSlug);
    if (!post) throw notFound("Post not found");

    const canModerate = blog.owner_id === auth.user.sub || (await isUserModeratorOrAdmin(auth.user.sub));
    const statuses = canModerate ? ["visible", "pending"] : ["visible"];
    const comments = await listBlogComments(post.id, statuses);
    return NextResponse.json({ success: true, data: { comments, canModerate }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ slug: string; postSlug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogWrite);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const post = await getBlogPostBySlug(blog.id, params.postSlug);
    if (!post) throw notFound("Post not found");

    const body = await validateBody(req, createSchema);
    const result = await addComment({ postId: post.id, authorId: auth.user.sub, parentCommentId: body.parentCommentId, body: body.body });
    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
