/**
 * app/api/economy/rewards/ad-reward/route.ts
 *
 * POST /api/economy/rewards/ad-reward
 *
 * Claim a rewarded ad coin bonus (free-tier users only).
 *
 * Rules:
 *  - Only free-plan users may call this endpoint.
 *  - Maximum 5 rewarded-ad claims per calendar day (UTC), tracked in Redis.
 *  - Each claim awards a random integer between 10 and 20 coins (inclusive).
 *  - The Redis counter key expires at midnight UTC to reset daily.
 *  - Coin credit is written to coin_ledger within the same db transaction
 *    as the users.coin_balance update (atomic).
 *
 * Response: { coinsAwarded: number, remainingToday: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { withAuth, type AuthContext } from "@/lib/api/middleware";
import { handleApiError, forbidden } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum rewarded-ad claims allowed per calendar day per user. */
const DAILY_AD_REWARD_CAP = 5;

/** Minimum coins awarded per rewarded ad. */
const MIN_COINS = 10;

/** Maximum coins awarded per rewarded ad. */
const MAX_COINS = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns an inclusive random integer between min and max.
 */
function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Computes the number of seconds until the next midnight UTC.
 * Used to set the Redis counter TTL so it resets at midnight.
 */
function secondsUntilMidnightUTC(): number {
  const now = new Date();
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
}

/**
 * Builds the Redis key for today's rewarded ad counter for a given user.
 */
function adRewardRedisKey(userId: string): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  return `ad_reward:${userId}:${today}`;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * Claim a rewarded ad coin bonus.
 * Only callable by authenticated free-plan users.
 */
export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  try {
    const userId = ctx.user.sub;

    // 1. Verify user is on the free plan (fetch from DB for accuracy)
    const userResult = await db.query<{ plan: string; coin_balance: number }>(
      `SELECT plan, coin_balance FROM users
       WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    const user = userResult.rows[0];
    if (!user) throw forbidden("User not found");

    if (user.plan !== "free") {
      throw forbidden(
        "Rewarded ads are only available for free-plan users. Upgrade to earn coins other ways.",
        "PAID_PLAN_INELIGIBLE"
      );
    }

    // 2. Check and increment Redis daily counter (atomic INCR)
    const redisKey = adRewardRedisKey(userId);
    const newCount = await redis.incr(redisKey);

    // On first increment, set expiry to midnight UTC
    if (newCount === 1) {
      await redis.expire(redisKey, secondsUntilMidnightUTC());
    }

    if (newCount > DAILY_AD_REWARD_CAP) {
      // Undo the increment we just did so the count stays accurate
      await redis.decr(redisKey);
      const remaining = 0;
      return NextResponse.json(
        {
          error: {
            code: "DAILY_LIMIT_REACHED",
            message: `You've claimed ${DAILY_AD_REWARD_CAP} rewarded ads today. Come back tomorrow!`,
          },
          remaining,
        },
        { status: 429 }
      );
    }

    // 3. Award random coins and write to coin_ledger atomically
    const coinsAwarded = randomIntInclusive(MIN_COINS, MAX_COINS);

    await db.transaction(async (client) => {
      // Lock user row and get current balance
      const lockResult = await client.query<{ coin_balance: number }>(
        `SELECT coin_balance FROM users
         WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [userId]
      );
      const balanceBefore = lockResult.rows[0]?.coin_balance ?? 0;
      const balanceAfter = balanceBefore + coinsAwarded;

      // Update user balance
      await client.query(
        `UPDATE users SET coin_balance = $1, updated_at = NOW() WHERE id = $2`,
        [balanceAfter, userId]
      );

      // Append-only ledger entry
      await client.query(
        `INSERT INTO coin_ledger
           (user_id, amount, balance_before, balance_after, transaction_type, description, created_at)
         VALUES ($1, $2, $3, $4, 'ad_reward', 'Rewarded ad bonus', NOW())`,
        [userId, coinsAwarded, balanceBefore, balanceAfter]
      );
    });

    const remainingToday = DAILY_AD_REWARD_CAP - newCount;

    return NextResponse.json({
      success: true,
      data: {
        coinsAwarded,
        remainingToday: Math.max(0, remainingToday),
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
