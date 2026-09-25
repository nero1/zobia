export const dynamic = 'force-dynamic';

/**
 * app/api/admin/ads/placements/route.ts
 *
 * GET  /api/admin/ads/placements — list the slot catalogue.
 * POST /api/admin/ads/placements — add a new slot (rare; most placements
 *      are seeded in db/migrations/0001_consolidated_schema.sql). PATCH toggles/edits an
 *      existing slot — app/api/admin/ads/placements/[key]/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
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
    // NOTE: `ad_placements` is not present in lib/db/schema.ts (schema/DB
    // mismatch — reported upstream), so this uses Drizzle's `sql` tag
    // directly rather than the query builder.
    const orm = await getDb();
    const result = await orm.execute(sql`SELECT * FROM ad_placements ORDER BY sort_order ASC, key ASC`);
    return NextResponse.json({ success: true, data: { placements: result.rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }: { auth: AdminContext }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, createSchema);
    const orm = await getDb();
    const result = await orm.execute(sql`
      INSERT INTO ad_placements (key, label, size, description, base_cpm_credits)
      VALUES (${body.key}, ${body.label}, ${body.size}, ${body.description ?? null}, ${body.baseCpmCredits}) RETURNING *
    `);
    return NextResponse.json({ success: true, data: { placement: result.rows[0] }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
