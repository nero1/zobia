export const dynamic = 'force-dynamic';

/**
 * app/api/admin/quest-boosts/route.ts
 *
 * Admin "campaign boost" for the daily quest deck engine — promote a
 * feature's quests ("show more blog/wiki quests this week") for a date
 * range. Read by lib/quests/questEngine.ts generateDailyDeck() to weight
 * template selection; if the admin sets nothing, the engine picks quests
 * with no bias (existing behavior).
 *
 * GET  /api/admin/quest-boosts — list boosts (past + active + upcoming).
 * POST /api/admin/quest-boosts — create a boost.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { QUEST_FEATURE_KEYS } from "@/lib/quests/questEngine";

const createSchema = z.object({
  featureKey: z.enum(QUEST_FEATURE_KEYS as unknown as [string, ...string[]]),
  weightMultiplier: z.number().positive().max(10).default(2),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  note: z.string().max(300).optional().nullable(),
});

interface BoostRow {
  id: string;
  feature_key: string;
  weight_multiplier: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
  created_by: string | null;
  created_by_username: string | null;
  created_at: string;
}

export const GET = withAdminAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { rows } = await db.query<BoostRow>(
      `SELECT b.id, b.feature_key, b.weight_multiplier, b.starts_at, b.ends_at, b.note, b.created_by,
              u.username AS created_by_username, b.created_at
       FROM quest_feature_boosts b
       LEFT JOIN users u ON u.id = b.created_by
       ORDER BY b.ends_at DESC`
    );
    return NextResponse.json({ success: true, data: { boosts: rows, featureKeys: QUEST_FEATURE_KEYS }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, createSchema);
    if (new Date(body.endsAt) <= new Date(body.startsAt)) {
      throw badRequest("endsAt must be after startsAt");
    }
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO quest_feature_boosts (feature_key, weight_multiplier, starts_at, ends_at, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [body.featureKey, body.weightMultiplier, body.startsAt, body.endsAt, body.note ?? null, auth.user.sub]
    );
    return NextResponse.json({ success: true, data: { boostId: rows[0].id }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
