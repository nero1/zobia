export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/route.ts
 *
 * GET   /api/blogs/<slug>  — blog detail (any authenticated user)
 * PATCH /api/blogs/<slug>  — update blog settings (owner only)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug, listBlogCategories } from "@/lib/blogs/repo";
import { updateBlogSettings } from "@/lib/blogs/service";
import { db } from "@/lib/db";

const updateSchema = z.object({
  title: z.string().trim().min(2).max(100).optional(),
  tagline: z.string().trim().max(160).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
  coverImageUrl: z.string().url().max(500).optional().nullable(),
  commentsEnabled: z.boolean().optional(),
  commentsModerationEnabled: z.boolean().optional(),
  hideAuthorInfo: z.boolean().optional(),
  showSubscriberCount: z.boolean().optional(),
});

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");

    const [categories, isSubscribed] = await Promise.all([
      listBlogCategories(blog.id),
      db.query<{ exists: boolean }>(`SELECT EXISTS(SELECT 1 FROM blog_subscriptions WHERE blog_id = $1 AND user_id = $2) AS exists`, [blog.id, auth.user.sub]).then((r) => r.rows[0]?.exists ?? false),
    ]);

    return NextResponse.json({
      success: true,
      data: { blog, categories, isOwner: blog.owner_id === auth.user.sub, isSubscribed },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const PATCH = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogWrite);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const body = await validateBody(req, updateSchema);
    await updateBlogSettings(blog.id, auth.user.sub, body);
    return NextResponse.json({ success: true, data: { updated: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
