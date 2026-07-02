export const dynamic = 'force-dynamic';

/**
 * app/api/login/daily/route.ts
 *
 * POST /api/login/daily
 *
 * Record a daily login and maintain the user's login streak.
 * Idempotent per calendar day — calling multiple times on the same day
 * returns the current streak without re-awarding XP.
 *
 * Streak milestones:
 *  - 7-day streak  → +200 XP bonus
 *  - 30-day streak → +1,000 XP bonus
 *
 * Base award: 50 XP per daily login.
 *
 * Redis key `daily_login:<userId>:<YYYY-MM-DD>` (TTL: 48 hours) prevents
 * double-awards within the same calendar day.
 *
 * Response: { streakDays: number, xpAwarded: number, isPersonalBest: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { withAuth, type AuthContext } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { creditCoins } from "@/lib/economy/coins";
import { triggerActivityQuestProgress } from "@/lib/quests/questEngine";
import { advanceNewMemberQuestStep } from "@/lib/quests/newMemberQuestEngine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base XP awarded for each daily login. */
const BASE_LOGIN_XP = 50;

/** Streak milestone bonuses: [streakDays, bonusXP] */
const STREAK_MILESTONES: [number, number][] = [
  [7, 200],
  [30, 1000],
];

/** TTL for the idempotency Redis key (48 hours gives a safe buffer). */
const DAILY_LOGIN_KEY_TTL_SECONDS = 48 * 60 * 60;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Redis key that marks today's login as already recorded for a given user.
 */
function dailyLoginRedisKey(userId: string, dateUTC: string): string {
  return `daily_login:${userId}:${dateUTC}`;
}

/**
 * Returns today's date string in YYYY-MM-DD (UTC).
 */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Returns yesterday's date string in YYYY-MM-DD (UTC).
 */
function yesterdayUTC(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserStreakRow {
  login_streak: number;
  longest_streak: number;
  last_login_date: string | null;
  xp_total: number;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Daily login recording endpoint.
 * Idempotent: safe to call multiple times per day.
 */
export const POST = withAuth(async (req: NextRequest, { auth }: { params: Record<string, string>; auth: AuthContext }) => {
  // Declared outside try so the catch block can delete it if the DB transaction fails.
  // Without cleanup, a failed transaction would leave the key set for the full TTL,
  // blocking the user from retrying their daily login claim.
  let redisKey: string | null = null;
  try {
    const userId = auth.user.sub;
    const today = todayUTC();
    const yesterday = yesterdayUTC();
    redisKey = dailyLoginRedisKey(userId, today);

    // Set idempotency key atomically BEFORE the transaction (NX ensures only one wins under concurrency)
    const acquired = await redis.set(redisKey, "1", "EX", DAILY_LOGIN_KEY_TTL_SECONDS, "NX");
    if (acquired === null) {
      // Another concurrent request already won the race
      const userResult = await db.query<UserStreakRow>(
        `SELECT login_streak, longest_streak FROM users
         WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId]
      );
      const user = userResult.rows[0];
      return NextResponse.json({
        success: true,
        data: {
          streakDays: user?.login_streak ?? 0,
          xpAwarded: 0,
          isPersonalBest: false,
          alreadyClaimedToday: true,
        },
        error: null,
      });
    }

    // Process the daily login inside a transaction
    const result = await db.transaction(async (client) => {
      // Lock user row for update
      const userResult = await client.query<UserStreakRow>(
        `SELECT login_streak, longest_streak, last_login_date, xp_total
         FROM users
         WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [userId]
      );
      const user = userResult.rows[0];
      if (!user) throw new Error("User not found");

      // Determine new streak
      const lastLogin = user.last_login_date
        ? user.last_login_date.slice(0, 10)
        : null;
      let newStreak: number;

      if (lastLogin === yesterday) {
        // Consecutive day — extend streak
        newStreak = user.login_streak + 1;
      } else if (lastLogin === today) {
        // Same day — already counted
        newStreak = user.login_streak;
      } else {
        // Gap — reset streak to 1
        newStreak = 1;
      }

      // Calculate XP to award
      let xpAwarded: number;
      if (lastLogin === today) {
        // Defensive: should not reach here due to Redis NX guard above
        xpAwarded = 0;
      } else {
        xpAwarded = BASE_LOGIN_XP;
        for (const [milestone, bonus] of STREAK_MILESTONES) {
          if (newStreak === milestone) {
            xpAwarded += bonus;
            break;
          }
        }
      }

      const newXpTotal = user.xp_total + xpAwarded;
      const newLongestStreak = Math.max(user.longest_streak, newStreak);
      const isPersonalBest = newStreak > user.longest_streak;

      // Update user record
      await client.query(
        `UPDATE users
         SET login_streak      = $1,
             login_streak_days = $1,
             longest_streak    = $2,
             last_login_date   = $3,
             last_login_at     = NOW(),
             last_active_at    = NOW(),
             xp_total          = $4,
             updated_at        = NOW()
         WHERE id = $5`,
        [newStreak, newLongestStreak, today, newXpTotal, userId]
      );

      // Append XP ledger entry
      await client.query(
        `INSERT INTO xp_ledger
           (user_id, amount, track, source, description, created_at)
         VALUES ($1, $2, 'main', 'daily_login', 'Daily login bonus', NOW())`,
        [userId, xpAwarded]
      );

      return { newStreak, xpAwarded, isPersonalBest };
    });

    // Trigger the login_streak daily quest ("Log in for 7 consecutive days") and
    // the daily_login New Member Quest step (fire-and-forget, non-fatal)
    void triggerActivityQuestProgress(userId, "login_streak", db);
    void advanceNewMemberQuestStep(db, userId, "daily_login");

    // Process any unclaimed comeback bonus coins (90-day re-engagement)
    let comebackBonusClaimed = 0;
    try {
      const { rows: pendingBonuses } = await db.query<{ id: string; amount: number }>(
        `SELECT id, amount FROM coin_ledger
         WHERE user_id = $1
           AND transaction_type = 'comeback_bonus_reserved'
           AND created_at > NOW() - INTERVAL '7 days'
           AND NOT EXISTS (
             SELECT 1 FROM coin_ledger cl2
             WHERE cl2.user_id = $1
               AND cl2.transaction_type = 'comeback_bonus_claimed'
               AND cl2.reference_id = coin_ledger.id::text
           )
         ORDER BY created_at ASC
         LIMIT 5`,
        [userId]
      );

      for (const bonus of pendingBonuses) {
        await creditCoins(
          userId,
          bonus.amount,
          "comeback_bonus_claimed",
          bonus.id,
          "Comeback bonus claimed on login",
          null
        );
        comebackBonusClaimed += bonus.amount;
      }
    } catch {
      // Non-fatal — streak/XP already recorded
    }

    return NextResponse.json({
      success: true,
      data: {
        streakDays: result.newStreak,
        xpAwarded: result.xpAwarded,
        isPersonalBest: result.isPersonalBest,
        alreadyClaimedToday: false,
        ...(comebackBonusClaimed > 0 && { comebackBonusClaimed }),
      },
      error: null,
    });
  } catch (err) {
    // If the DB transaction failed after we set the Redis key, delete it so the
    // user can retry their daily login claim without waiting for the TTL to expire.
    if (redisKey) await redis.del(redisKey).catch(() => {});
    return handleApiError(err);
  }
});
