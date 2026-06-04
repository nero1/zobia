/**
 * app/api/business/tier/route.ts
 *
 * PATCH /api/business/tier
 *
 * Upgrade the authenticated user's business account tier.
 * Body: { tier: "starter" | "growth" | "enterprise" }
 *
 * Validates the requested tier is higher than the current tier.
 * In a full implementation, this would initiate a payment flow.
 * For now, records the tier change pending payment confirmation.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

const TIER_ORDER: Record<string, number> = {
  starter: 1,
  growth: 2,
  enterprise: 3,
};

const upgradeTierSchema = z.object({
  tier: z.enum(["starter", "growth", "enterprise"]),
});

export const PATCH = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const userId = auth.user.sub;
    const body = await validateBody(req, upgradeTierSchema);
    const { tier: newTier } = body;

    const { rows } = await db.query<{ id: string; tier: string }>(
      `SELECT id, tier FROM business_accounts WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

    if (!rows[0]) throw notFound("No business account found");

    const currentTier = rows[0].tier.toLowerCase();
    if ((TIER_ORDER[currentTier] ?? 0) >= (TIER_ORDER[newTier] ?? 0)) {
      throw badRequest(`Cannot downgrade from ${currentTier} to ${newTier}`);
    }

    const { rows: updated } = await db.query<{ id: string; tier: string; updated_at: string }>(
      `UPDATE business_accounts
       SET tier = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, tier, updated_at`,
      [newTier, rows[0].id]
    );

    return NextResponse.json({
      success: true,
      data: { id: updated[0].id, tier: updated[0].tier },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
