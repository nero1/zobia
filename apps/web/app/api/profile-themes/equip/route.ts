export const dynamic = "force-dynamic";

/**
 * app/api/profile-themes/equip/route.ts
 *
 * POST /api/profile-themes/equip
 * Body: { themeId: string, currency?: 'credits' | 'stars' }
 *
 * Equips a theme the caller already has (free-default/plan-included/owned).
 * If `currency` is given and the theme isn't yet free/owned, this also
 * purchases it first (same ledger as /api/economy/cosmetics) then equips it.
 * Mirrors POST /api/blogs/<slug>/themes/equip.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { equipProfileTheme, purchaseAndEquipProfileTheme } from "@/lib/profile/themes";
import { triggerActivityQuestProgress } from "@/lib/quests/questEngine";
import { db } from "@/lib/db";

const bodySchema = z.object({
  themeId: z.string().min(1).max(60),
  currency: z.enum(["credits", "stars"]).optional(),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const body = await validateBody(req, bodySchema);

    const { rows } = await db.query<{ plan: string; business_account_id: string | null }>(
      `SELECT u.plan, ba.id AS business_account_id
       FROM users u LEFT JOIN business_accounts ba ON ba.user_id = u.id
       WHERE u.id = $1 LIMIT 1`,
      [auth.user.sub]
    );
    const plan = rows[0]?.plan ?? "free";
    const businessTier = rows[0]?.business_account_id
      ? (await db.query<{ tier: string }>(`SELECT tier FROM business_accounts WHERE user_id = $1 LIMIT 1`, [auth.user.sub])).rows[0]?.tier ?? null
      : null;

    if (body.currency) {
      const result = await purchaseAndEquipProfileTheme(auth.user.sub, plan, businessTier, body.themeId, body.currency);
      if (!result.alreadyOwned) void triggerActivityQuestProgress(auth.user.sub, "market_purchase", db);
      return NextResponse.json({ success: true, data: { themeId: body.themeId, alreadyOwned: result.alreadyOwned }, error: null });
    }

    await equipProfileTheme(auth.user.sub, plan, businessTier, body.themeId);
    return NextResponse.json({ success: true, data: { themeId: body.themeId }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
