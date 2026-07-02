export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/posts/route.ts
 *
 * GET  /api/blogs/<slug>/posts — list published articles (or, for the owner,
 *   optionally drafts) in reverse-chron order, or pages in menu order.
 *   ?type=article|page&status=draft (owner only)&categoryId=&cursor=&limit=
 * POST /api/blogs/<slug>/posts — create an article/page (blog owner only)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug, listBlogPosts } from "@/lib/blogs/repo";
import { createPost } from "@/lib/blogs/service";
import { db } from "@/lib/db";

const listQuerySchema = z.object({
  type: z.enum(["article", "page"]).default("article"),
  status: z.enum(["draft", "published"]).optional(),
  categoryId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.string().optional().transform((v) => (v ? Math.min(parseInt(v, 10), 50) : 20)),
});

const createSchema = z.object({
  type: z.enum(["article", "page"]).default("article"),
  title: z.string().trim().min(2).max(200),
  excerpt: z.string().trim().max(500).optional().nullable(),
  bodyMarkdown: z.string().trim().min(1).max(60_000),
  featuredImageUrl: z.string().url().max(500).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
  isPaywalled: z.boolean().optional(),
  paywallCreditsCost: z.number().int().min(0).max(100_000).optional(),
  status: z.enum(["draft", "published"]).default("draft"),
});

export const GET = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");

    const query = validateSearchParams(req.nextUrl.searchParams, listQuerySchema);
    const isOwner = blog.owner_id === auth.user.sub;
    if (query.status === "draft" && !isOwner) throw forbidden("Only the blog owner can view drafts.");

    const result = await listBlogPosts(blog.id, {
      type: query.type,
      status: query.status ?? "published",
      categoryId: query.categoryId ?? null,
      cursor: query.cursor ?? null,
      limit: query.limit,
    });
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ slug: string }>(async (req: NextRequest, { auth, params }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogWrite);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");

    const body = await validateBody(req, createSchema);
    const { rows } = await db.query<{ plan: string }>(`SELECT plan FROM users WHERE id = $1 LIMIT 1`, [auth.user.sub]);
    const plan = rows[0]?.plan ?? "free";

    const result = await createPost({
      blogId: blog.id,
      authorId: auth.user.sub,
      authorPlan: plan,
      type: body.type,
      title: body.title,
      excerpt: body.excerpt,
      bodyMarkdown: body.bodyMarkdown,
      featuredImageUrl: body.featuredImageUrl,
      categoryId: body.categoryId,
      isPaywalled: body.isPaywalled,
      paywallCreditsCost: body.paywallCreditsCost,
      status: body.status,
    });
    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
