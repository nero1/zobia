export const dynamic = "force-dynamic";

/**
 * app/api/profile-themes/route.ts
 *
 * GET /api/profile-themes — the caller-facing theme catalog with per-theme
 * availability (free_default / plan_included / owned / purchasable / locked),
 * mirrors GET /api/blogs/<slug>/themes.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getAvailableProfileThemes } from "@/lib/profile/themes";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const orm = await getDb();
    const [user] = await orm
      .select({
        plan: schema.users.plan,
        active_profile_theme_id: schema.users.activeProfileThemeId,
        business_account_id: schema.businessAccounts.id,
      })
      .from(schema.users)
      .leftJoin(schema.businessAccounts, eq(schema.businessAccounts.userId, schema.users.id))
      .where(eq(schema.users.id, auth.user.sub))
      .limit(1);
    const businessTier = user?.business_account_id
      ? (
          await orm
            .select({ tier: schema.businessAccounts.tier })
            .from(schema.businessAccounts)
            .where(eq(schema.businessAccounts.userId, auth.user.sub))
            .limit(1)
        )[0]?.tier ?? null
      : null;

    const themes = await getAvailableProfileThemes(auth.user.sub, user?.active_profile_theme_id ?? "classic", user?.plan ?? "free", businessTier);
    return NextResponse.json({ success: true, data: { themes }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
