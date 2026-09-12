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
import { db } from "@/lib/db";

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const { rows } = await db.query<{ plan: string; active_profile_theme_id: string; business_account_id: string | null }>(
      `SELECT u.plan, u.active_profile_theme_id, ba.id AS business_account_id
       FROM users u
       LEFT JOIN business_accounts ba ON ba.user_id = u.id
       WHERE u.id = $1 LIMIT 1`,
      [auth.user.sub]
    );
    const user = rows[0];
    const businessTier = user?.business_account_id
      ? (await db.query<{ tier: string }>(`SELECT tier FROM business_accounts WHERE user_id = $1 LIMIT 1`, [auth.user.sub])).rows[0]?.tier ?? null
      : null;

    const themes = await getAvailableProfileThemes(auth.user.sub, user?.active_profile_theme_id ?? "classic", user?.plan ?? "free", businessTier);
    return NextResponse.json({ success: true, data: { themes }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
