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
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    if (blog.owner_id !== auth.user.sub) throw forbidden("Only the blog owner can manage its theme.");

    const orm = await getDb();
    const [userRow] = await orm
      .select({ plan: schema.users.plan })
      .from(schema.users)
      .where(eq(schema.users.id, auth.user.sub))
      .limit(1);
    let businessTier: string | null = null;
    if (blog.business_account_id) {
      const [businessRow] = await orm
        .select({ tier: schema.businessAccounts.tier })
        .from(schema.businessAccounts)
        .where(eq(schema.businessAccounts.id, blog.business_account_id))
        .limit(1);
      businessTier = businessRow?.tier ?? null;
    }

    const themes = await getAvailableThemesForBlog(blog.id, blog.active_theme_id, auth.user.sub, userRow?.plan ?? "free", businessTier);
    return NextResponse.json({ success: true, data: { themes }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
