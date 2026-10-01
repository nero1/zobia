export const dynamic = 'force-dynamic';

/**
 * app/api/admin/seasons/[seasonId]/route.ts
 *
 * Single season management.
 *
 * PATCH /api/admin/seasons/[seasonId]
 *   Update name, theme, description, passPriceCoins, rewardPoolCoins.
 *   Cannot change dates of an already-active season.
 *
 * DELETE /api/admin/seasons/[seasonId]
 *   End (deactivate) the season immediately. Triggers reward distribution.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { endSeason } from "@/lib/seasons/seasonEngine";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const patchSeasonSchema = z.object({
  name: z.string().min(3).max(100).optional(),
  theme: z.string().min(1).max(50).optional(),
  description: z.string().max(500).optional(),
  passPriceCoins: z.number().int().positive().optional(),
  rewardPoolCoins: z.number().int().nonnegative().optional(),
  /** Reschedule end date (only allowed if season hasn't started yet). */
  endsAt: z.string().datetime().optional(),
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/seasons/[seasonId]
// ---------------------------------------------------------------------------

export const PATCH = withAdminAuth(async (
  req: NextRequest,
  { params, auth }: { params: { seasonId: string }; auth: { user: { sub: string }; isAdmin: true } }
) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { seasonId } = await params as { seasonId: string };

    const body = await validateBody(req, patchSeasonSchema);

    const orm = await getDb();

    const existing = await orm
      .select({
        id: schema.seasons.id,
        is_active: schema.seasons.isActive,
        starts_at: schema.seasons.startsAt,
        ends_at: schema.seasons.endsAt,
      })
      .from(schema.seasons)
      .where(eq(schema.seasons.id, seasonId))
      .limit(1);
    if (!existing[0]) throw notFound("Season not found");

    const season = existing[0];

    // Cannot change end date if season is already underway
    if (body.endsAt && season.is_active && new Date(season.starts_at) < new Date()) {
      throw badRequest("Cannot change end date of an already-active season. End the season first.");
    }

    const setValues: Partial<typeof schema.seasons.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) setValues.name = body.name;
    if (body.theme !== undefined) setValues.theme = body.theme;
    if (body.description !== undefined) setValues.description = body.description;
    if (body.passPriceCoins !== undefined) setValues.passPriceCoins = body.passPriceCoins;
    if (body.rewardPoolCoins !== undefined) setValues.rewardPoolCoins = body.rewardPoolCoins;
    if (body.endsAt !== undefined) setValues.endsAt = new Date(body.endsAt);

    const rows = await orm
      .update(schema.seasons)
      .set(setValues)
      .where(eq(schema.seasons.id, seasonId))
      .returning();

    return NextResponse.json({
      success: true,
      data: { season: rows[0] },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/seasons/[seasonId]  (End season early)
// ---------------------------------------------------------------------------

export const DELETE = withAdminAuth(async (
  req: NextRequest,
  { params, auth }: { params: { seasonId: string }; auth: { user: { sub: string }; isAdmin: true } }
) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { seasonId } = await params as { seasonId: string };

    const orm = await getDb();

    const existing = await orm
      .select({
        id: schema.seasons.id,
        name: schema.seasons.name,
        is_active: schema.seasons.isActive,
        reward_pool_coins: schema.seasons.rewardPoolCoins,
      })
      .from(schema.seasons)
      .where(eq(schema.seasons.id, seasonId))
      .limit(1);
    if (!existing[0]) throw notFound("Season not found");

    if (!existing[0].is_active) {
      throw badRequest("Season is already inactive");
    }

    // Pull ends_at forward to now (the season stays active until endSeason
    // claims it), then run the exact same end-of-season transition as the
    // daily-platform CRON: archive + reset rankings, pay the top-10 reward
    // pool, open the closing-ceremony room. Previously this route paid
    // rewards *before* the season was marked 'ended', so the payout claim
    // always skipped, and it then deactivated the season so the CRON never
    // picked it up either: rankings were never reset and no rewards paid.
    await orm
      .update(schema.seasons)
      .set({ endsAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.seasons.id, seasonId), eq(schema.seasons.isActive, true)));

    const { ended, ceremonyRoomId } = await endSeason(seasonId, existing[0].name, orm);
    if (!ended) {
      throw badRequest("Season is already inactive");
    }
    logger.info({ seasonId, adminId: auth.user.sub, ceremonyRoomId }, "[admin/seasons] season ended early");

    return NextResponse.json({
      success: true,
      data: {
        seasonId,
        seasonName: existing[0].name,
        ceremonyRoomId,
        message: "Season ended and rewards distributed.",
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
