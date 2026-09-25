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
import { getDb, schema } from "@/lib/db/drizzle";
import { eq } from "drizzle-orm";

const bodySchema = z.object({
  themeId: z.string().min(1).max(60),
  currency: z.enum(["credits", "stars"]).optional(),
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const body = await validateBody(req, bodySchema);

    const orm = await getDb();
    const [row] = await orm
      .select({ plan: schema.users.plan, businessAccountId: schema.businessAccounts.id })
      .from(schema.users)
      .leftJoin(schema.businessAccounts, eq(schema.businessAccounts.userId, schema.users.id))
      .where(eq(schema.users.id, auth.user.sub))
      .limit(1);
    const plan = row?.plan ?? "free";
    let businessTier: string | null = null;
    if (row?.businessAccountId) {
      const [biz] = await orm
        .select({ tier: schema.businessAccounts.tier })
        .from(schema.businessAccounts)
        .where(eq(schema.businessAccounts.userId, auth.user.sub))
        .limit(1);
      businessTier = biz?.tier ?? null;
    }

    if (body.currency) {
      const result = await purchaseAndEquipProfileTheme(auth.user.sub, plan, businessTier, body.themeId, body.currency);
      if (!result.alreadyOwned) void triggerActivityQuestProgress(auth.user.sub, "market_purchase", orm);
      return NextResponse.json({ success: true, data: { themeId: body.themeId, alreadyOwned: result.alreadyOwned }, error: null });
    }

    await equipProfileTheme(auth.user.sub, plan, businessTier, body.themeId);
    return NextResponse.json({ success: true, data: { themeId: body.themeId }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
