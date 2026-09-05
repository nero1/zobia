export const dynamic = "force-dynamic";

/**
 * app/api/blogs/[slug]/themes/equip/route.ts
 *
 * POST /api/blogs/<slug>/themes/equip
 * Body: { themeId: string, currency?: 'credits' | 'stars' }
 *
 * Equips a theme the owner already has (free-default/plan-included/owned).
 * If `currency` is given and the theme isn't yet free/owned, this also
 * purchases it first (same ledger as /api/economy/cosmetics/purchase) then
 * equips it — one round-trip for the dashboard's "Buy for X credits" button.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, forbidden, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getBlogBySlug } from "@/lib/blogs/repo";
import { equipTheme, purchaseAndEquipTheme } from "@/lib/blogs/themes";
import { db } from "@/lib/db";

const bodySchema = z.object({
  themeId: z.string().min(1).max(60),
  currency: z.enum(["credits", "stars"]).optional(),
});

export const POST = withAuth<{ slug: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const blog = await getBlogBySlug(params.slug);
    if (!blog) throw notFound("Blog not found");
    if (blog.owner_id !== auth.user.sub) throw forbidden("Only the blog owner can manage its theme.");

    const body = await validateBody(req, bodySchema);
    const { rows: userRows } = await db.query<{ plan: string }>(`SELECT plan FROM users WHERE id = $1 LIMIT 1`, [auth.user.sub]);
    const plan = userRows[0]?.plan ?? "free";
    const businessTier = blog.business_account_id
      ? (await db.query<{ tier: string }>(`SELECT tier FROM business_accounts WHERE id = $1 LIMIT 1`, [blog.business_account_id])).rows[0]?.tier ?? null
      : null;

    if (body.currency) {
      const result = await purchaseAndEquipTheme(blog.id, auth.user.sub, plan, businessTier, body.themeId, body.currency);
      return NextResponse.json({ success: true, data: { themeId: body.themeId, alreadyOwned: result.alreadyOwned }, error: null });
    }

    await equipTheme(blog.id, auth.user.sub, plan, businessTier, body.themeId);
    return NextResponse.json({ success: true, data: { themeId: body.themeId }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
