export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ads/coupons/route.ts
 *
 * GET  /api/admin/ads/coupons — list all ad-budget coupons.
 * POST /api/admin/ads/coupons — create a free/discounted-ad-spend code.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

const createSchema = z.object({
  code: z.string().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/),
  discountType: z.enum(["percent", "flat_credits", "free_credits"]),
  discountValue: z.number().positive().max(1_000_000),
  maxRedemptions: z.number().int().positive().max(1_000_000).optional(),
  minBudgetCredits: z.number().nonnegative().max(1_000_000_000).default(0),
  expiresAt: z.string().datetime().optional(),
});

export const GET = withAdminAuth(async (_req: NextRequest, { auth }: { auth: AdminContext }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { rows } = await db.query(`SELECT * FROM ad_coupons ORDER BY created_at DESC LIMIT 200`);
    return NextResponse.json({ success: true, data: { coupons: rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }: { auth: AdminContext }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, createSchema);

    const { rows } = await db.query(
      `INSERT INTO ad_coupons (code, discount_type, discount_value, max_redemptions, min_budget_credits, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        body.code.toUpperCase(),
        body.discountType,
        body.discountValue,
        body.maxRedemptions ?? null,
        body.minBudgetCredits,
        body.expiresAt ?? null,
        auth.user.sub,
      ]
    );

    return NextResponse.json({ success: true, data: { coupon: rows[0] }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
