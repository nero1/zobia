export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/messages/[messageId]/route.ts
 *
 * PATCH /api/blogs/<slug>/messages/<messageId> — mark a contact message read.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug } from "@/lib/blogs/repo";
import { markContactMessageRead } from "@/lib/blogs/service";

export const PATCH = withAuth<{ slug: string; messageId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    await markContactMessageRead(blog.id, auth.user.sub, params.messageId);
    return NextResponse.json({ success: true, data: { updated: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
