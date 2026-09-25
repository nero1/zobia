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
import { sanitizeBlogPostHtml, plainTextToBlogPostHtml } from "@/lib/security/htmlSanitizer";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";

const updateSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  excerpt: z.string().trim().max(500).optional().nullable(),
  bodyMarkdown: z.string().trim().min(1).max(60_000).optional(),
  contentFormat: z.enum(["markdown", "plaintext"]).optional(),
  featuredImageUrl: z.string().url().max(500).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  isPaywalled: z.boolean().optional(),
  paywallCreditsCost: z.number().int().min(0).max(100_000).optional(),
  status: z.enum(["draft", "published"]).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

function previewHtml(bodyMarkdown: string, wordCount: number, contentFormat: string): { html: string; previewWords: number } {
  const previewWords = Math.max(100, Math.round(wordCount * 0.2));
  const words = bodyMarkdown.trim().split(/\s+/);
  const truncated = words.slice(0, previewWords).join(" ");
  const html = contentFormat === "plaintext" ? plainTextToBlogPostHtml(truncated) : sanitizeBlogPostHtml(truncated);
  return { html, previewWords };
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

    const orm = await getDb();

    if (post.is_paywalled && post.paywall_credits_cost > 0 && !isAuthor && !isMod) {
      const [unlockRow] = await orm
        .select({ id: schema.blogPostUnlocks.id })
        .from(schema.blogPostUnlocks)
        .where(and(eq(schema.blogPostUnlocks.postId, post.id), eq(schema.blogPostUnlocks.userId, auth.user.sub)))
        .limit(1);
      if (!unlockRow) {
        locked = true;
        const preview = previewHtml(post.body_markdown, post.word_count, (post as { content_format?: string }).content_format ?? "markdown");
        bodyHtml = preview.html;
        previewWordCount = preview.previewWords;
      }
    }

    const [likeRow] = await orm
      .select({ id: schema.blogPostLikes.id })
      .from(schema.blogPostLikes)
      .where(and(eq(schema.blogPostLikes.postId, post.id), eq(schema.blogPostLikes.userId, auth.user.sub)))
      .limit(1);

    return NextResponse.json({
      success: true,
      data: {
        post: { ...post, body_html: bodyHtml, body_markdown: locked ? undefined : post.body_markdown },
        locked,
        previewWordCount,
        isAuthor,
        isLiked: !!likeRow,
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
    const orm = await getDb();
    const [userRow] = await orm
      .select({ plan: schema.users.plan })
      .from(schema.users)
      .where(eq(schema.users.id, auth.user.sub))
      .limit(1);
    await updatePost(post.id, auth.user.sub, userRow?.plan ?? "free", body);
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
