export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ads/placements/[key]/route.ts
 *
 * PATCH /api/admin/ads/placements/:key — toggle active state or edit
 * CPM/label for an existing ad slot.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface Ctx {
  params: Promise<{ key: string }>;
  auth: AdminContext;
}

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  baseCpmCredits: z.number().positive().max(1_000_000).optional(),
  label: z.string().min(2).max(100).optional(),
});

export const PATCH = withAdminAuth(async (req: NextRequest, { params, auth }: Ctx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { key } = await params;
    const body = await validateBody(req, patchSchema);

    const { rows } = await db.query(
      `UPDATE ad_placements
       SET is_active = COALESCE($1, is_active),
           base_cpm_credits = COALESCE($2, base_cpm_credits),
           label = COALESCE($3, label),
           updated_at = NOW()
       WHERE key = $4
       RETURNING *`,
      [body.isActive ?? null, body.baseCpmCredits ?? null, body.label ?? null, key]
    );
    if (!rows[0]) throw notFound("Placement not found");

    return NextResponse.json({ success: true, data: { placement: rows[0] }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
