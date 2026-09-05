export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/themes/route.ts
 *
 * GET /api/blogs/<slug>/themes — the owner-facing theme catalog with
 * per-theme availability (free_default / plan_included / owned /
 * purchasable / locked) for this specific blog.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, forbidden, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug } from "@/lib/blogs/repo";
import { getAvailableThemesForBlog } from "@/lib/blogs/themes";
import { db } from "@/lib/db";

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    if (blog.owner_id !== auth.user.sub) throw forbidden("Only the blog owner can manage its theme.");

    const { rows: userRows } = await db.query<{ plan: string }>(`SELECT plan FROM users WHERE id = $1 LIMIT 1`, [auth.user.sub]);
    const businessTier = blog.business_account_id
      ? (await db.query<{ tier: string }>(`SELECT tier FROM business_accounts WHERE id = $1 LIMIT 1`, [blog.business_account_id])).rows[0]?.tier ?? null
      : null;

    const themes = await getAvailableThemesForBlog(blog.id, blog.active_theme_id, auth.user.sub, userRows[0]?.plan ?? "free", businessTier);
    return NextResponse.json({ success: true, data: { themes }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
