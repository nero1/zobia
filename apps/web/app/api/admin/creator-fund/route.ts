export const dynamic = 'force-dynamic';

/**
 * app/api/admin/creator-fund/route.ts
 *
 * GET /api/admin/creator-fund — Creator Fund overview (admin only).
 *
 * Returns the current pool balance (accrued live from
 * lib/creator/fundContribution.ts's per-activity contributions plus any
 * manual top-up — see POST /api/admin/creator-fund/topup) and the
 * admin-configured split percent per contributing activity (also editable
 * generically via /admin/config, this just saves a round-trip for the
 * dedicated Creator Fund admin page).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";
import { getCreatorFundSplitPercent, type CreatorFundActivity } from "@/lib/creator/fundContribution";

const ACTIVITIES: CreatorFundActivity[] = [
  "room_subscription",
  "room_entry",
  "coin_purchase",
  "sponsor_budget",
  "ad_reward",
];

export const GET = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { rows } = await db.query<{ value: string }>(
      `SELECT value FROM x_manifest WHERE key = 'creator_fund_balance_kobo' LIMIT 1`
    );
    const balanceKobo = parseInt(rows[0]?.value ?? "0", 10);

    const splits = Object.fromEntries(
      await Promise.all(ACTIVITIES.map(async (a) => [a, await getCreatorFundSplitPercent(a)] as const))
    );

    return NextResponse.json({
      success: true,
      data: { balanceKobo, splits },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
