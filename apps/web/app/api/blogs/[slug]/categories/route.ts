export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/categories/route.ts
 *
 * GET  /api/blogs/<slug>/categories — list categories (with post counts)
 * POST /api/blogs/<slug>/categories — create a category (blog owner only)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug, listBlogCategories } from "@/lib/blogs/repo";
import { createCategory } from "@/lib/blogs/service";

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const categories = await listBlogCategories(blog.id);
    return NextResponse.json({ success: true, data: { categories }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogWrite);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const body = await validateBody(req, createSchema);
    const result = await createCategory(blog.id, auth.user.sub, body.name);
    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
