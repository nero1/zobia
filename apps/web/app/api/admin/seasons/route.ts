/**
 * app/api/admin/seasons/route.ts
 *
 * Admin season lifecycle management.
 *
 * GET /api/admin/seasons
 *   List all seasons (current + history), ordered most-recent-first.
 *
 * POST /api/admin/seasons
 *   Create a new season. Automatically deactivates any previously active season.
 *   Body: { name, theme, startsAt, endsAt, passPriceCoins, rewardPoolCoins }
 *
 * PATCH /api/admin/seasons/[seasonId] is handled in the sibling [seasonId]/route.ts
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const createSeasonSchema = z.object({
  /** Display name for the season (e.g. "Season 3 — Rise of the Legends"). */
  name: z.string().min(3).max(100),
  /** Visual theme identifier used by the front-end (e.g. "fire", "ocean"). */
  theme: z.string().min(1).max(50),
  /** ISO-8601 datetime when the season opens. */
  startsAt: z.string().datetime({ message: "startsAt must be a valid ISO-8601 datetime" }),
  /** ISO-8601 datetime when the season closes. */
  endsAt: z.string().datetime({ message: "endsAt must be a valid ISO-8601 datetime" }),
  /** Coin price to purchase the Season Pass. Defaults to manifest value. */
  passPriceCoins: z.number().int().positive().default(500),
  /** Total coins to distribute to top-10 finishers at season end. */
  rewardPoolCoins: z.number().int().nonnegative().default(0),
  /** Optional description / lore copy shown in the app. */
  description: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface SeasonRow {
  id: string;
  name: string;
  theme: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  pass_price_coins: number;
  reward_pool_coins: number;
  description: string | null;
  created_at: string;
  created_by: string | null;
}

// ---------------------------------------------------------------------------
// GET /api/admin/seasons
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { rows } = await db.query<SeasonRow>(
      `SELECT id, name, theme, starts_at, ends_at, is_active,
              pass_price_coins, reward_pool_coins, description, created_at, created_by
       FROM seasons
       ORDER BY starts_at DESC`
    );

    return NextResponse.json({
      success: true,
      data: { seasons: rows, total: rows.length },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/seasons
// ---------------------------------------------------------------------------

/**
 * Create a new season.
 *
 * Business rules:
 *  - endsAt must be after startsAt.
 *  - Only one season can be active at a time. Creating a new season with
 *    startsAt <= NOW() deactivates the currently active season (if any) and
 *    activates the new one. Future seasons (startsAt > NOW()) are created
 *    as is_active=FALSE and activated automatically when the season start
 *    cron runs.
 *  - A season cannot be created if another active season's end_date is in
 *    the future and would overlap.
 */
export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, createSeasonSchema);

    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);

    if (endsAt <= startsAt) {
      throw badRequest("endsAt must be after startsAt");
    }

    const isImmediatelyActive = startsAt <= new Date();

    const season = await db.transaction(async (tx) => {
      // Check for overlapping active seasons
      const { rows: overlapping } = await tx.query<{ id: string; name: string }>(
        `SELECT id, name FROM seasons
         WHERE is_active = TRUE
           AND NOT (ends_at <= $1 OR starts_at >= $2)
         LIMIT 1`,
        [body.startsAt, body.endsAt]
      );

      if (overlapping.length > 0) {
        throw conflict(
          `Season dates overlap with active season "${overlapping[0].name}". ` +
          `End the current season before creating an overlapping one.`
        );
      }

      // If starting now (or in the past), deactivate any currently active season
      if (isImmediatelyActive) {
        await tx.query(
          `UPDATE seasons SET is_active = FALSE, updated_at = NOW()
           WHERE is_active = TRUE AND ends_at > NOW()`
        );
      }

      // Insert the new season
      const { rows: newRows } = await tx.query<SeasonRow>(
        `INSERT INTO seasons
           (name, theme, starts_at, ends_at, is_active,
            pass_price_coins, reward_pool_coins, description,
            created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         RETURNING *`,
        [
          body.name,
          body.theme,
          body.startsAt,
          body.endsAt,
          isImmediatelyActive,
          body.passPriceCoins,
          body.rewardPoolCoins,
          body.description ?? null,
          auth.user.sub,
        ]
      );

      return newRows[0];
    });

    if (!season) throw new Error("Season creation failed");

    return NextResponse.json(
      {
        success: true,
        data: {
          season,
          isActive: isImmediatelyActive,
          message: isImmediatelyActive
            ? "Season created and activated immediately."
            : "Season created and will activate at the scheduled start time.",
        },
        error: null,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
