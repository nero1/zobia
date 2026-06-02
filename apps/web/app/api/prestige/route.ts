/**
 * app/api/prestige/route.ts
 *
 * Prestige system endpoints.
 *
 * GET  /api/prestige
 *   - Returns the user's prestige eligibility and current prestige count.
 *   - Eligible only at Zobia Icon rank, sublevel III.
 *
 * POST /api/prestige
 *   - Execute prestige.
 *   - Resets main XP and rank only.
 *   - Preserves all tracks, coins, items, guild membership, season history.
 *   - Awards prestige-specific rewards (frame, title, coins).
 *   - Increments prestige_count on the user record.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden } from "@/lib/api/errors";
import { getRankForXP } from "@/lib/xp/engine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Prestige is only available at this rank. */
const PRESTIGE_REQUIRED_RANK = "Zobia Icon";

/** Prestige is only available at sublevel III. */
const PRESTIGE_REQUIRED_SUBLEVEL = 3;

/** Coins awarded for each prestige. */
const PRESTIGE_COIN_REWARD = 5_000;

/** Prestige-specific badge/frame type prefix. */
const PRESTIGE_BADGE_TYPE = "prestige_frame";

// ---------------------------------------------------------------------------
// GET /api/prestige
// ---------------------------------------------------------------------------

/**
 * Returns eligibility and current prestige count for the calling user.
 */
export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const { rows } = await db.query<{
      xp_total: number;
      prestige_count: number;
    }>(
      `SELECT xp_total, COALESCE(prestige_count, 0) AS prestige_count
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    const user = rows[0];
    if (!user) throw forbidden("User not found");

    const rank = getRankForXP(user.xp_total);
    const eligible =
      rank.rankName === PRESTIGE_REQUIRED_RANK &&
      rank.sublevel === PRESTIGE_REQUIRED_SUBLEVEL;

    return NextResponse.json({
      success: true,
      data: {
        eligible,
        prestigeCount: user.prestige_count,
        currentRank: rank,
        requirements: {
          rank: PRESTIGE_REQUIRED_RANK,
          sublevel: PRESTIGE_REQUIRED_SUBLEVEL,
          xpRequired: rank.rankName === PRESTIGE_REQUIRED_RANK ? "Already at required rank" : `${rank.nextRankXp} XP needed`,
        },
        rewards: {
          coins: PRESTIGE_COIN_REWARD,
          frame: `${PRESTIGE_BADGE_TYPE}_${(user.prestige_count + 1)}`,
          title: `Prestige ${user.prestige_count + 1}`,
        },
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/prestige
// ---------------------------------------------------------------------------

/**
 * Execute prestige for the calling user.
 *
 * Atomically:
 *  1. Verifies eligibility (Zobia Icon rank, sublevel III).
 *  2. Resets xp_total to 0 (main XP only).
 *  3. Increments prestige_count.
 *  4. Awards PRESTIGE_COIN_REWARD coins.
 *  5. Inserts prestige frame into user_badges.
 *  6. Writes xp_ledger entry for the reset event.
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const result = await db.transaction(async (client) => {
      // 1. Lock user row
      const { rows } = await client.query<{
        xp_total: number;
        prestige_count: number;
        coin_balance: number;
      }>(
        `SELECT xp_total, COALESCE(prestige_count, 0) AS prestige_count, coin_balance
         FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [userId]
      );
      const user = rows[0];
      if (!user) throw forbidden("User not found");

      // 2. Verify eligibility
      const rank = getRankForXP(user.xp_total);
      if (rank.rankName !== PRESTIGE_REQUIRED_RANK) {
        throw badRequest(
          `Prestige requires ${PRESTIGE_REQUIRED_RANK} rank. Current: ${rank.rankName}`,
          "PRESTIGE_RANK_NOT_MET"
        );
      }
      if (rank.sublevel !== PRESTIGE_REQUIRED_SUBLEVEL) {
        throw badRequest(
          `Prestige requires sublevel III. Current: sublevel ${rank.sublevel}`,
          "PRESTIGE_SUBLEVEL_NOT_MET"
        );
      }

      const newPrestigeCount = user.prestige_count + 1;
      const xpBefore = user.xp_total;
      const newCoinBalance = user.coin_balance + PRESTIGE_COIN_REWARD;

      // 3. Reset main XP, increment prestige_count, award coins
      await client.query(
        `UPDATE users
         SET xp_total = 0,
             prestige_count = $1,
             coin_balance = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [newPrestigeCount, newCoinBalance, userId]
      );

      // 4. Record XP reset in xp_ledger
      await client.query(
        `INSERT INTO xp_ledger (user_id, action, xp_amount, multiplier, xp_net, metadata, created_at)
         VALUES ($1, 'prestige_reset', $2, 1, $2, $3, NOW())`,
        [
          userId,
          -xpBefore,
          JSON.stringify({ prestige_count: newPrestigeCount, xp_reset_from: xpBefore }),
        ]
      );

      // 5. Record coin award in coin_ledger
      await client.query(
        `INSERT INTO coin_ledger (user_id, amount, balance_before, balance_after, transaction_type, description, created_at)
         VALUES ($1, $2, $3, $4, 'prestige_reward', $5, NOW())`,
        [
          userId,
          PRESTIGE_COIN_REWARD,
          user.coin_balance,
          newCoinBalance,
          `Prestige ${newPrestigeCount} reward`,
        ]
      );

      // 6. Award prestige frame badge
      const badgeType = `${PRESTIGE_BADGE_TYPE}_${newPrestigeCount}`;
      await client.query(
        `INSERT INTO user_badges (user_id, badge_type, reference_id, awarded_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, badge_type, reference_id) DO NOTHING`,
        [userId, badgeType, userId]
      );

      return {
        prestigeCount: newPrestigeCount,
        xpReset: xpBefore,
        coinsAwarded: PRESTIGE_COIN_REWARD,
        newCoinBalance,
        badgeAwarded: badgeType,
        title: `Prestige ${newPrestigeCount}`,
      };
    });

    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
