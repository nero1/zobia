export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/gifts/mine/route.ts
 *
 * GET — blog owner: every gift tier for this blog (enabled + disabled +
 * expired), for the dashboard's manage-tiers screen. Distinct from the
 * public GET /gifts, which only returns purchasable tiers.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug } from "@/lib/blogs/repo";
import { listGiftTiersForOwner } from "@/lib/blogs/service";

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    const tiers = await listGiftTiersForOwner(auth.user.sub, blog.id);
    return NextResponse.json({ success: true, data: { tiers }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
