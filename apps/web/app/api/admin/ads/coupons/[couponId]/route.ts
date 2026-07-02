export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ads/coupons/[couponId]/route.ts
 *
 * PATCH /api/admin/ads/coupons/:couponId — deactivate/reactivate a coupon.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface Ctx {
  params: Promise<{ couponId: string }>;
  auth: AdminContext;
}

const patchSchema = z.object({ isActive: z.boolean() });

export const PATCH = withAdminAuth(async (req: NextRequest, { params, auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { couponId } = await params;
    const body = await validateBody(req, patchSchema);

    const { rows } = await db.query(
      `UPDATE ad_coupons SET is_active = $1 WHERE id = $2 RETURNING *`,
      [body.isActive, couponId]
    );
    if (!rows[0]) throw notFound("Coupon not found");

    return NextResponse.json({ success: true, data: { coupon: rows[0] }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
