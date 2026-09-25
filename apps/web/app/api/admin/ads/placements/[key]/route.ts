export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ads/placements/[key]/route.ts
 *
 * PATCH /api/admin/ads/placements/:key — toggle active state or edit
 * CPM/label for an existing ad slot.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
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

    // NOTE: `ad_placements` is not present in lib/db/schema.ts (schema/DB
    // mismatch — reported upstream), so this uses Drizzle's `sql` tag
    // directly rather than the query builder.
    const orm = await getDb();
    const result = await orm.execute(sql`
      UPDATE ad_placements
      SET is_active = COALESCE(${body.isActive ?? null}, is_active),
          base_cpm_credits = COALESCE(${body.baseCpmCredits ?? null}, base_cpm_credits),
          label = COALESCE(${body.label ?? null}, label),
          updated_at = NOW()
      WHERE key = ${key}
      RETURNING *
    `);
    if (!result.rows[0]) throw notFound("Placement not found");

    return NextResponse.json({ success: true, data: { placement: result.rows[0] }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
