export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/posts/[postSlug]/route.ts
 *
 * GET    — single article/page. Paywalled articles the viewer hasn't
 *          unlocked (and isn't the author/a moderator) get a truncated
 *          preview instead of the full body ("Pay N credits to read the rest").
 * PATCH  — update (author only)
 * DELETE — soft delete (author or moderator)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug, getBlogPostBySlug } from "@/lib/blogs/repo";
import { updatePost, deletePost, isUserModeratorOrAdmin } from "@/lib/blogs/service";
import { sanitizeBlogPostHtml } from "@/lib/security/htmlSanitizer";
import { db } from "@/lib/db";

const updateSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  excerpt: z.string().trim().max(500).optional().nullable(),
  bodyMarkdown: z.string().trim().min(1).max(60_000).optional(),
  featuredImageUrl: z.string().url().max(500).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  isPaywalled: z.boolean().optional(),
  paywallCreditsCost: z.number().int().min(0).max(100_000).optional(),
  status: z.enum(["draft", "published"]).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

function previewHtml(bodyMarkdown: string, wordCount: number): { html: string; previewWords: number } {
  const previewWords = Math.max(100, Math.round(wordCount * 0.2));
  const words = bodyMarkdown.trim().split(/\s+/);
  const truncated = words.slice(0, previewWords).join(" ");
  return { html: sanitizeBlogPostHtml(truncated), previewWords };
}

export const GET = withAuth<{ slug: string; postSlug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const post = await getBlogPostBySlug(blog.id, params.postSlug);
    if (!post) throw notFound("Post not found");

    const isAuthor = post.author_id === auth.user.sub;
    const isMod = isAuthor ? true : await isUserModeratorOrAdmin(auth.user.sub);
    if (post.status !== "published" && !isAuthor && !isMod) throw notFound("Post not found");

    let locked = false;
    let bodyHtml = post.body_html;
    let previewWordCount: number | null = null;

    if (post.is_paywalled && post.paywall_credits_cost > 0 && !isAuthor && !isMod) {
      const { rows } = await db.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM blog_post_unlocks WHERE post_id = $1 AND user_id = $2) AS exists`,
        [post.id, auth.user.sub]
      );
      if (!rows[0]?.exists) {
        locked = true;
        const preview = previewHtml(post.body_markdown, post.word_count);
        bodyHtml = preview.html;
        previewWordCount = preview.previewWords;
      }
    }

    const { rows: likeRows } = await db.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM blog_post_likes WHERE post_id = $1 AND user_id = $2) AS exists`,
      [post.id, auth.user.sub]
    );

    return NextResponse.json({
      success: true,
      data: {
        post: { ...post, body_html: bodyHtml, body_markdown: locked ? undefined : post.body_markdown },
        locked,
        previewWordCount,
        isAuthor,
        isLiked: !!likeRows[0]?.exists,
        blog: { slug: blog.slug, title: blog.title, hideAuthorInfo: blog.hide_author_info },
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const PATCH = withAuth<{ slug: string; postSlug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogWrite);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const post = await getBlogPostBySlug(blog.id, params.postSlug);
    if (!post) throw notFound("Post not found");

    const body = await validateBody(req, updateSchema);
    const { rows } = await db.query<{ plan: string }>(`SELECT plan FROM users WHERE id = $1 LIMIT 1`, [auth.user.sub]);
    await updatePost(post.id, auth.user.sub, rows[0]?.plan ?? "free", body);
    return NextResponse.json({ success: true, data: { updated: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ slug: string; postSlug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogWrite);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const post = await getBlogPostBySlug(blog.id, params.postSlug);
    if (!post) throw notFound("Post not found");

    const isMod = await isUserModeratorOrAdmin(auth.user.sub);
    await deletePost(post.id, auth.user.sub, isMod);
    return NextResponse.json({ success: true, data: { deleted: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
