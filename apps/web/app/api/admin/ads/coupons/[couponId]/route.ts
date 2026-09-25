export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ads/coupons/[couponId]/route.ts
 *
 * PATCH /api/admin/ads/coupons/:couponId — deactivate/reactivate a coupon.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
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

    // NOTE: `ad_coupons` is not present in lib/db/schema.ts (schema/DB
    // mismatch — reported upstream), so this uses Drizzle's `sql` tag
    // directly rather than the query builder.
    const orm = await getDb();
    const result = await orm.execute(sql`
      UPDATE ad_coupons SET is_active = ${body.isActive} WHERE id = ${couponId} RETURNING *
    `);
    if (!result.rows[0]) throw notFound("Coupon not found");

    return NextResponse.json({ success: true, data: { coupon: result.rows[0] }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
