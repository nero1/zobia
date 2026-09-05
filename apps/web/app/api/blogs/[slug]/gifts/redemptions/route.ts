export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/gifts/redemptions/route.ts
 *
 * GET — blog owner: recent gift purchases across all of this blog's tiers,
 * for the dashboard's redemption feed.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug } from "@/lib/blogs/repo";
import { listGiftPurchasesForBlog } from "@/lib/blogs/service";

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const purchases = await listGiftPurchasesForBlog(auth.user.sub, blog.id);
    return NextResponse.json({ success: true, data: { purchases }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
