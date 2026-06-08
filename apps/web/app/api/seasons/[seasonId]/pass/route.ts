export const dynamic = 'force-dynamic';

/**
 * app/api/seasons/[seasonId]/pass/route.ts
 *
 * Season pass endpoints.
 *
 * GET  /api/seasons/[seasonId]/pass
 *   - Returns the calling user's season pass for this season.
 *   - Creates a free pass record if one doesn't exist yet.
 *
 * POST /api/seasons/[seasonId]/pass
 *   - Purchase the paid season pass.
 *   - Costs pass_price_coins (from the season record).
 *   - Deducted atomically from the user's coin balance.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound, conflict } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface SeasonPassRow {
  id: string;
  user_id: string;
  season_id: string;
  is_paid: boolean;
  season_xp: number;
  season_rank: number | null;
  purchased_at: string | null;
  created_at: string;
}

interface SeasonRow {
  id: string;
  name: string;
  is_active: boolean;
  pass_price_coins: number;
  ends_at: string;
}

interface UserPlanRow {
  plan: string;
}

// ---------------------------------------------------------------------------
// GET /api/seasons/[seasonId]/pass
// ---------------------------------------------------------------------------

/**
 * Get or create the user's free season pass for the given season.
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { seasonId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { seasonId } = params;
      const userId = auth.user.sub;

      const seasonResult = await db.query<SeasonRow>(
        `SELECT id, name, is_active, pass_price_coins, ends_at FROM seasons WHERE id = $1`,
        [seasonId]
      );
      if (!seasonResult.rows[0]) throw notFound("Season not found");

      // Upsert free pass record
      const passResult = await db.query<SeasonPassRow>(
        `INSERT INTO user_season_passes (user_id, season_id, is_paid, season_xp, created_at)
         VALUES ($1, $2, FALSE, 0, NOW())
         ON CONFLICT (user_id, season_id) DO UPDATE SET updated_at = NOW()
         RETURNING id, user_id, season_id, is_paid, season_xp, season_rank, purchased_at, created_at`,
        [userId, seasonId]
      );

      return NextResponse.json({
        success: true,
        data: { pass: passResult.rows[0], season: seasonResult.rows[0] },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/seasons/[seasonId]/pass
// ---------------------------------------------------------------------------

/**
 * Purchase the paid season pass. Costs pass_price_coins from the season record.
 * Atomically deducts from the user's coin balance.
 */
export const POST = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { seasonId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { seasonId } = params;
      const userId = auth.user.sub;

      const result = await db.transaction(async (client) => {
        // 1. Lock and verify season
        const seasonResult = await client.query<SeasonRow>(
          `SELECT id, name, is_active, pass_price_coins, ends_at
           FROM seasons WHERE id = $1 FOR UPDATE`,
          [seasonId]
        );
        const season = seasonResult.rows[0];
        if (!season) throw notFound("Season not found");
        if (!season.is_active || new Date(season.ends_at) <= new Date()) {
          throw badRequest("Season is no longer active", "SEASON_ENDED");
        }

        // 2. Check user doesn't already have paid pass
        const existingPass = await client.query<{ is_paid: boolean }>(
          `SELECT is_paid FROM user_season_passes WHERE user_id = $1 AND season_id = $2`,
          [userId, seasonId]
        );
        if (existingPass.rows[0]?.is_paid) {
          throw conflict("You already own the paid pass for this season", "PASS_ALREADY_OWNED");
        }

        // 3. Read user's plan and coin balance; apply plan discount
        const userRow = await client.query<{ coin_balance: number } & UserPlanRow>(
          `SELECT coin_balance, plan FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
          [userId]
        );
        if (!userRow.rows[0]) throw notFound("User not found");

        const { coin_balance, plan } = userRow.rows[0];

        // Determine discount percentage based on plan (PRD §3)
        const PLAN_DISCOUNTS: Record<string, number> = {
          plus: 10,
          pro: 20,
          max: 30,
        };
        const discountPercent = PLAN_DISCOUNTS[plan] ?? 0;
        const originalPrice = season.pass_price_coins;
        const discountedPrice = Math.floor(originalPrice * (1 - discountPercent / 100));

        if (coin_balance < discountedPrice) {
          throw badRequest(
            `Insufficient coins. Pass costs ${discountedPrice} coins.`,
            "INSUFFICIENT_BALANCE"
          );
        }

        const newBalance = coin_balance - discountedPrice;
        await client.query(
          `UPDATE users SET coin_balance = $1, updated_at = NOW() WHERE id = $2`,
          [newBalance, userId]
        );

        await client.query(
          `INSERT INTO coin_ledger (user_id, amount, balance_before, balance_after, transaction_type, reference_id, description, created_at)
           VALUES ($1, $2, $3, $4, 'season_pass_purchase', $5, $6, NOW())`,
          [
            userId,
            -discountedPrice,
            coin_balance,
            newBalance,
            seasonId,
            `Season pass: ${season.name}`,
          ]
        );

        // 4. Upsert pass as paid
        const passResult = await client.query<SeasonPassRow>(
          `INSERT INTO user_season_passes (user_id, season_id, is_paid, season_xp, purchased_at, created_at)
           VALUES ($1, $2, TRUE, 0, NOW(), NOW())
           ON CONFLICT (user_id, season_id) DO UPDATE
             SET is_paid = TRUE, purchased_at = NOW(), updated_at = NOW()
           RETURNING id, user_id, season_id, is_paid, season_xp, season_rank, purchased_at, created_at`,
          [userId, seasonId]
        );

        return {
          pass: passResult.rows[0],
          coinsSpent: discountedPrice,
          newCoinBalance: newBalance,
          originalPrice,
          discountPercent,
          discountedPrice,
        };
      });

      return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
