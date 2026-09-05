export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/messages/route.ts
 *
 * GET /api/blogs/<slug>/messages — the blog owner's Contact-form inbox.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug } from "@/lib/blogs/repo";
import { listContactMessages } from "@/lib/blogs/service";

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const messages = await listContactMessages(blog.id, auth.user.sub);
    return NextResponse.json({ success: true, data: { messages }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
