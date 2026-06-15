export const dynamic = 'force-dynamic';

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

/**
 * Coins awarded at Prestige 1 only (PRD §9).
 * Subsequent prestiges award stars, not coins.
 */
const PRESTIGE_P1_COIN_REWARD = 500;

/** Stars awarded per prestige after P1 (PRD §11). */
const PRESTIGE_STAR_REWARD = 1;

/** Prestige-specific badge/frame type prefix. */
const PRESTIGE_BADGE_TYPE = "prestige_frame";

/** 3× XP boost duration in days after each prestige (PRD §9). */
const PRESTIGE_XP_BOOST_DAYS = 7;

/**
 * Named prestige rewards by milestone prestige count.
 * Each entry describes the title badge key and human-readable title.
 */
const PRESTIGE_MILESTONE_REWARDS: Record<
  number,
  { badgeKey: string; title: string; description: string }
> = {
  1:  { badgeKey: "prestige_phoenix",           title: "Phoenix",          description: "Arose from the ashes. Prestige 1 achieved." },
  3:  { badgeKey: "prestige_elder_candidate",   title: "Elder Candidate",  description: "Three times reborn. Elder Candidate status unlocked." },
  5:  { badgeKey: "prestige_veteran",           title: "Veteran Prestige", description: "Five times the legend. Veteran Prestige badge awarded." },
  10: { badgeKey: "prestige_hall_of_fame",      title: "Hall of Fame",     description: "Ten prestiges. Inducted into the Zobia Hall of Fame." },
};

// ---------------------------------------------------------------------------
// GET /api/prestige
// ---------------------------------------------------------------------------

/**
 * Returns eligibility and current prestige count for the calling user.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
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
          coins: user.prestige_count === 0 ? PRESTIGE_P1_COIN_REWARD : 0,
          stars: user.prestige_count > 0 ? PRESTIGE_STAR_REWARD : 0,
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
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
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
      const coinReward = user.prestige_count === 0 ? PRESTIGE_P1_COIN_REWARD : 0;
      const starReward = user.prestige_count > 0 ? PRESTIGE_STAR_REWARD : 0;
      const newCoinBalance = user.coin_balance + coinReward;

      // Calculate 7-day XP boost window (3× for first 7 days, PRD §9 Prestige 3)
      // Only applies when newPrestigeCount >= 3
      const boostExpiresAt = newPrestigeCount >= 3
        ? new Date(Date.now() + PRESTIGE_XP_BOOST_DAYS * 24 * 60 * 60 * 1000).toISOString()
        : null;

      // 3. Reset main XP, increment prestige_count, award coins, set boost
      await client.query(
        `UPDATE users
         SET xp_total = 0,
             prestige_count = $1,
             coin_balance = $2,
             star_balance = COALESCE(star_balance, 0) + $3,
             prestige_cycle_boost_expires_at = $4,
             updated_at = NOW()
         WHERE id = $5`,
        [newPrestigeCount, newCoinBalance, starReward, boostExpiresAt, userId]
      );

      // 4. Record XP reset in xp_ledger
      await client.query(
        `INSERT INTO xp_ledger (user_id, amount, track, source, base_amount, created_at)
         VALUES ($1, $2, 'main', 'prestige_reset', $2, NOW())`,
        [userId, -xpBefore]
      );

      // 5. Record coin award in coin_ledger (P1 only)
      if (coinReward > 0) {
        await client.query(
          `INSERT INTO coin_ledger (user_id, amount, balance_before, balance_after, transaction_type, description, created_at)
           VALUES ($1, $2, $3, $4, 'prestige_reward', $5, NOW())`,
          [
            userId,
            coinReward,
            user.coin_balance,
            newCoinBalance,
            `Prestige ${newPrestigeCount} coin reward`,
          ]
        );
      }

      // 5b. Record star award in star_ledger (P2+)
      if (starReward > 0) {
        await client.query(
          `INSERT INTO star_ledger (user_id, amount, transaction_type, description, created_at)
           VALUES ($1, $2, 'prestige_reward', $3, NOW())`,
          [userId, starReward, `Prestige ${newPrestigeCount} star reward`]
        ).catch(() => {}); // non-fatal if star_ledger doesn't exist yet
      }

      // 6. Award prestige frame badge (numbered, e.g. prestige_frame_1)
      const badgeType = `${PRESTIGE_BADGE_TYPE}_${newPrestigeCount}`;
      await client.query(
        `INSERT INTO user_badges (user_id, badge_type, badge_key, awarded_at, metadata)
         VALUES ($1, $2, $2, NOW(), $3)
         ON CONFLICT (user_id, badge_key) DO NOTHING`,
        [userId, badgeType, JSON.stringify({ prestigeCount: newPrestigeCount })]
      );

      // 7. Award named milestone rewards (Phoenix, Elder Candidate, Veteran, Hall of Fame)
      const milestoneReward = PRESTIGE_MILESTONE_REWARDS[newPrestigeCount];
      const awardsGranted: string[] = [badgeType];
      if (milestoneReward) {
        await client.query(
          `INSERT INTO user_badges (user_id, badge_type, badge_key, awarded_at, metadata)
           VALUES ($1, $2, $2, NOW(), $3)
           ON CONFLICT (user_id, badge_key) DO NOTHING`,
          [
            userId,
            milestoneReward.badgeKey,
            JSON.stringify({
              title: milestoneReward.title,
              description: milestoneReward.description,
              prestigeCount: newPrestigeCount,
            }),
          ]
        );
        awardsGranted.push(milestoneReward.badgeKey);

        // For Hall of Fame (Prestige 10), write to the dedicated table
        if (newPrestigeCount === 10) {
          // Fetch current legacy_score for the hall of fame record
          const { rows: legacyRows } = await client.query<{ legacy_score: number }>(
            `SELECT COALESCE(legacy_score, 0) AS legacy_score FROM users WHERE id = $1`,
            [userId]
          );
          await client.query(
            `INSERT INTO hall_of_fame (user_id, inducted_at, prestige_count, legacy_score)
             VALUES ($1, NOW(), $2, $3)
             ON CONFLICT (user_id) DO UPDATE
             SET prestige_count = $2, legacy_score = $3, inducted_at = NOW()`,
            [userId, newPrestigeCount, legacyRows[0]?.legacy_score ?? 0]
          );
        }
      }

      // 8. In-app notification for the prestige achievement
      await client.query(
        `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
         VALUES ($1, 'prestige_complete', $2, false, NOW())`,
        [
          userId,
          JSON.stringify({
            prestigeCount: newPrestigeCount,
            title: milestoneReward?.title ?? `Prestige ${newPrestigeCount}`,
            badgesAwarded: awardsGranted,
            boostActive: boostExpiresAt !== null,
            boostExpiresAt,
          }),
        ]
      ).catch(() => {}); // notifications table may have different schema — non-fatal

      return {
        prestigeCount: newPrestigeCount,
        xpReset: xpBefore,
        coinsAwarded: coinReward,
        starsAwarded: starReward,
        newCoinBalance,
        badgesAwarded: awardsGranted,
        title: milestoneReward?.title ?? `Prestige ${newPrestigeCount}`,
        boostActive: boostExpiresAt !== null,
        boostExpiresAt,
        milestoneReward: milestoneReward ?? null,
      };
    });

    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
