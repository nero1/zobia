export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/posts/batch/route.ts
 *
 * PATCH /api/blogs/<slug>/posts/batch — batch draft/delete for the owner's
 * post-management screen (dashboard). { postIds: string[], action: "draft"|"delete" }.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug } from "@/lib/blogs/repo";
import { batchUpdatePosts } from "@/lib/blogs/service";

const batchSchema = z.object({
  postIds: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(["draft", "delete"]),
});

export const PATCH = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.blogWrite);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");

    const body = await validateBody(req, batchSchema);
    const result = await batchUpdatePosts(blog.id, auth.user.sub, body.postIds, body.action);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
