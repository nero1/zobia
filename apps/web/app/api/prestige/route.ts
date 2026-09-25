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
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

    const orm = await getDb();
    const [user] = await orm
      .select({ xpTotal: schema.users.xpTotal, prestigeCount: schema.users.prestigeCount })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!user) throw forbidden("User not found");
    const xpTotal = Number(user.xpTotal);
    const prestigeCount = user.prestigeCount ?? 0;

    const rank = getRankForXP(xpTotal);
    const eligible =
      rank.rankName === PRESTIGE_REQUIRED_RANK &&
      rank.sublevel === PRESTIGE_REQUIRED_SUBLEVEL;

    return NextResponse.json({
      success: true,
      data: {
        eligible,
        prestigeCount,
        currentRank: rank,
        requirements: {
          rank: PRESTIGE_REQUIRED_RANK,
          sublevel: PRESTIGE_REQUIRED_SUBLEVEL,
          xpRequired: rank.rankName === PRESTIGE_REQUIRED_RANK ? "Already at required rank" : `${rank.nextRankXp} XP needed`,
        },
        rewards: {
          coins: prestigeCount === 0 ? PRESTIGE_P1_COIN_REWARD : 0,
          stars: prestigeCount > 0 ? PRESTIGE_STAR_REWARD : 0,
          frame: `${PRESTIGE_BADGE_TYPE}_${(prestigeCount + 1)}`,
          title: `Prestige ${prestigeCount + 1}`,
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

    const orm = await getDb();
    const result = await orm.transaction(async (client) => {
      // 1. Lock user row
      const [userRow] = await client
        .select({
          xpTotal: schema.users.xpTotal,
          prestigeCount: schema.users.prestigeCount,
          coinBalance: schema.users.coinBalance,
        })
        .from(schema.users)
        .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
        .for("update");
      if (!userRow) throw forbidden("User not found");
      const user = {
        xp_total: Number(userRow.xpTotal),
        prestige_count: userRow.prestigeCount ?? 0,
        coin_balance: Number(userRow.coinBalance),
      };

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
      await client
        .update(schema.users)
        .set({
          xpTotal: BigInt(0),
          prestigeCount: newPrestigeCount,
          coinBalance: BigInt(newCoinBalance),
          starBalance: sql`COALESCE(${schema.users.starBalance}, 0) + ${starReward}`,
          prestigeCycleBoostExpiresAt: boostExpiresAt ? new Date(boostExpiresAt) : null,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, userId));

      // 4. Record XP reset in xp_ledger
      await client.insert(schema.xpLedger).values({
        userId,
        amount: -xpBefore,
        track: "main",
        source: "prestige_reset",
        baseAmount: -xpBefore,
      });

      // 5. Record coin award in coin_ledger (P1 only)
      if (coinReward > 0) {
        await client.insert(schema.coinLedger).values({
          userId,
          amount: BigInt(coinReward),
          balanceBefore: BigInt(user.coin_balance),
          balanceAfter: BigInt(newCoinBalance),
          transactionType: "prestige_reward",
          description: `Prestige ${newPrestigeCount} coin reward`,
        });
      }

      // 5b. Record star award in star_ledger (P2+)
      if (starReward > 0) {
        await client
          .insert(schema.starLedger)
          .values({
            userId,
            amount: BigInt(starReward),
            transactionType: "prestige_reward",
            description: `Prestige ${newPrestigeCount} star reward`,
          })
          .catch(() => {}); // non-fatal if star_ledger doesn't exist yet
      }

      // 6. Award prestige frame badge (numbered, e.g. prestige_frame_1)
      const badgeType = `${PRESTIGE_BADGE_TYPE}_${newPrestigeCount}`;
      await client
        .insert(schema.userBadges)
        .values({
          userId,
          badgeType,
          badgeKey: badgeType,
          metadata: { prestigeCount: newPrestigeCount },
        })
        .onConflictDoNothing({
          target: [schema.userBadges.userId, schema.userBadges.badgeKey],
        });

      // 7. Award named milestone rewards (Phoenix, Elder Candidate, Veteran, Hall of Fame)
      const milestoneReward = PRESTIGE_MILESTONE_REWARDS[newPrestigeCount];
      const awardsGranted: string[] = [badgeType];
      if (milestoneReward) {
        await client
          .insert(schema.userBadges)
          .values({
            userId,
            badgeType: milestoneReward.badgeKey,
            badgeKey: milestoneReward.badgeKey,
            metadata: {
              title: milestoneReward.title,
              description: milestoneReward.description,
              prestigeCount: newPrestigeCount,
            },
          })
          .onConflictDoNothing({
            target: [schema.userBadges.userId, schema.userBadges.badgeKey],
          });
        awardsGranted.push(milestoneReward.badgeKey);

        // For Hall of Fame (Prestige 10), write to the dedicated table
        if (newPrestigeCount === 10) {
          // Fetch current legacy_score for the hall of fame record
          const [legacyRow] = await client
            .select({ legacyScore: schema.users.legacyScore })
            .from(schema.users)
            .where(eq(schema.users.id, userId))
            .limit(1);
          const legacyScore = legacyRow?.legacyScore ?? BigInt(0);
          await client
            .insert(schema.hallOfFame)
            .values({
              userId,
              prestigeCount: newPrestigeCount,
              legacyScore,
            })
            .onConflictDoUpdate({
              target: schema.hallOfFame.userId,
              set: { prestigeCount: newPrestigeCount, legacyScore, inductedAt: new Date() },
            });
        }
      }

      // 8. In-app notification for the prestige achievement
      await client
        .insert(schema.notifications)
        .values({
          userId,
          type: "prestige_complete",
          payload: {
            prestigeCount: newPrestigeCount,
            title: milestoneReward?.title ?? `Prestige ${newPrestigeCount}`,
            badgesAwarded: awardsGranted,
            boostActive: boostExpiresAt !== null,
            boostExpiresAt,
          },
          isRead: false,
        })
        .catch(() => {}); // notifications table may have different schema — non-fatal

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
