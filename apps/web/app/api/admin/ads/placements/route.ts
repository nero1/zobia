export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ads/placements/route.ts
 *
 * GET  /api/admin/ads/placements — list the slot catalogue.
 * POST /api/admin/ads/placements — add a new slot (rare; most placements
 *      are seeded in db/migrations/0006_ads.sql). PATCH toggles/edits an
 *      existing slot — app/api/admin/ads/placements/[key]/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody, type AdminContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

const createSchema = z.object({
  key: z.string().min(2).max(50).regex(/^[a-z0-9_]+$/),
  label: z.string().min(2).max(100),
  size: z.enum(["300x250", "320x50", "interstitial", "rewarded", "native"]),
  description: z.string().max(500).optional(),
  baseCpmCredits: z.number().positive().max(1_000_000).default(500),
});

export const GET = withAdminAuth(async (_req: NextRequest, { auth }: { auth: AdminContext }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { rows } = await db.query(`SELECT * FROM ad_placements ORDER BY sort_order ASC, key ASC`);
    return NextResponse.json({ success: true, data: { placements: rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }: { auth: AdminContext }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, createSchema);
    const { rows } = await db.query(
      `INSERT INTO ad_placements (key, label, size, description, base_cpm_credits)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [body.key, body.label, body.size, body.description ?? null, body.baseCpmCredits]
    );
    return NextResponse.json({ success: true, data: { placement: rows[0] }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
