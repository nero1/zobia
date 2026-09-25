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
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";

const menuItemSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().trim().min(1).max(60),
  type: z.enum(["url", "post", "page", "category"]),
  targetId: z.string().max(200).optional().nullable(),
  externalUrl: z.string().max(500).optional().nullable(),
});

const menuConfigSchema = z.object({
  orientation: z.enum(["horizontal", "vertical"]),
  items: z.array(menuItemSchema).max(20),
});

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
  menuConfig: menuConfigSchema.optional(),
});

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");

    const orm = await getDb();
    const [categories, subscriptionRows] = await Promise.all([
      listBlogCategories(blog.id),
      orm
        .select({ id: schema.blogSubscriptions.id })
        .from(schema.blogSubscriptions)
        .where(and(eq(schema.blogSubscriptions.blogId, blog.id), eq(schema.blogSubscriptions.userId, auth.user.sub)))
        .limit(1),
    ]);
    const isSubscribed = subscriptionRows.length > 0;

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
