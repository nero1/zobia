export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * app/api/cron/daily-core/route.ts
 *
 * CRON slot 1 of 7 — runs at 23:00 UTC (midnight WAT / UTC+1).
 * Vercel Hobby: scheduled via vercel.json, once per day.
 *
 * Core user-state resets that must happen first each night:
 *  1. Reset daily quests
 *  2. Update login streaks (increment yesterday's, reset missed)
 *  3. Award daily login XP
 *  4. Expire moments older than 24 hours
 *  5. Sweep expired coin-purchased message pins
 *  6. Enforce plan-based message history limits (Free=90d, Plus=180d)
 *
 * All operations are set-based SQL — no per-row loops.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateCronSecret, checkCronIdempotency } from "@/lib/cron/auth";
import { resetDailyQuests } from "@/lib/quests/questEngine";
import { XP_VALUES } from "@/lib/xp/engine";
import { getCurrentSeason } from "@/lib/seasons/seasonEngine";

export const GET = async (req: NextRequest) => {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const didClaim = await checkCronIdempotency("cron_daily_core_last_run", db);
  if (!didClaim) {
    return NextResponse.json({ skipped: true, reason: "Already ran today" });
  }

  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  // 1. Reset daily quests
  try {
    results.questReset = await resetDailyQuests(db);
  } catch (err) {
    errors.push(`questReset: ${String(err)}`);
  }

  // 2. Update login streaks — set-based, single-pass
  // BUG-04: use CURRENT_DATE (not CURRENT_DATE - 1) so users who logged in today
  //         get their streak incremented during the same night's CRON run.
  // BUG-21: update each column from its own current value to avoid cross-column
  //         references that are confusing and error-prone in a single SET clause.
  try {
    const [streakUpdate, streakReset] = await Promise.all([
      db.query<{ count: string }>(
        `WITH updated AS (
           UPDATE users
           SET login_streak_days = login_streak_days + 1,
               login_streak      = login_streak + 1,
               updated_at        = NOW()
           WHERE last_login_date = CURRENT_DATE
           RETURNING 1
         )
         SELECT COUNT(*) AS count FROM updated`
      ),
      db.query<{ count: string }>(
        `WITH reset AS (
           UPDATE users
           SET last_streak_before_break = login_streak_days,
               longest_streak           = GREATEST(COALESCE(longest_streak, 0), login_streak_days),
               login_streak_days        = 0,
               login_streak             = 0,
               updated_at               = NOW()
           WHERE last_login_date < CURRENT_DATE
             AND login_streak_days > 0
           RETURNING 1
         )
         SELECT COUNT(*) AS count FROM reset`
      ),
    ]);
    results.loginStreaks = {
      incremented: parseInt(streakUpdate.rows[0]?.count ?? "0"),
      reset: parseInt(streakReset.rows[0]?.count ?? "0"),
    };
  } catch (err) {
    errors.push(`loginStreaks: ${String(err)}`);
  }

  // 3. Award daily login XP — set-based
  // BUG-03: also upsert leaderboard_snapshots for every user who receives XP.
  // BUG-04: use CURRENT_DATE so today's logins qualify (same as the streak fix above).
  try {
    const loginXpResult = await db.query<{ user_id: string; new_xp_total: string; city: string | null; season_xp: string }>(
      `WITH awarded AS (
         INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, base_amount, created_at)
         SELECT id, $1, 'main', 'daily_login',
                'daily_login:' || id::text || ':' || CURRENT_DATE::text,
                $1, NOW()
         FROM users
         WHERE last_login_date = CURRENT_DATE
           AND deleted_at IS NULL
         ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
         RETURNING user_id
       ),
       updated AS (
         UPDATE users SET xp_total = xp_total + $1, updated_at = NOW()
         WHERE id IN (SELECT user_id FROM awarded)
         RETURNING id AS user_id, xp_total AS new_xp_total, city, season_xp
       )
       SELECT user_id, new_xp_total::text, city, season_xp::text FROM updated`,
      [XP_VALUES.daily_login]
    );

    const usersAwarded = loginXpResult.rows.length;

    if (usersAwarded > 0) {
      const userIds = loginXpResult.rows.map(r => r.user_id);
      const xpTotals = loginXpResult.rows.map(r => Number(r.new_xp_total));

      // Global scope snapshot
      await db.query(
        `INSERT INTO leaderboard_snapshots (user_id, track, scope, city, season_id, xp_value, updated_at)
         SELECT unnest($1::uuid[]), 'main', 'global', NULL, NULL, unnest($2::int[]), NOW()
         ON CONFLICT (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))
         DO UPDATE SET xp_value = EXCLUDED.xp_value, updated_at = NOW()`,
        [userIds, xpTotals]
      ).catch((err: unknown) => errors.push(`dailyLoginXP:leaderboard:global: ${String(err)}`));

      // City-scoped snapshots for users with a city set
      const cityUsers = loginXpResult.rows.filter(r => r.city);
      if (cityUsers.length > 0) {
        await db.query(
          `INSERT INTO leaderboard_snapshots (user_id, track, scope, city, season_id, xp_value, updated_at)
           SELECT unnest($1::uuid[]), 'main', 'city', unnest($2::text[]), NULL, unnest($3::int[]), NOW()
           ON CONFLICT (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))
           DO UPDATE SET xp_value = EXCLUDED.xp_value, updated_at = NOW()`,
          [cityUsers.map(r => r.user_id), cityUsers.map(r => r.city), cityUsers.map(r => Number(r.new_xp_total))]
        ).catch((err: unknown) => errors.push(`dailyLoginXP:leaderboard:city: ${String(err)}`));
      }

      // Season-scoped snapshots if an active season exists
      try {
        const activeSeason = await getCurrentSeason(db);
        if (activeSeason) {
          const seasonUserIds = loginXpResult.rows.map(r => r.user_id);
          const seasonXps = loginXpResult.rows.map(r => Number(r.season_xp));
          await db.query(
            `INSERT INTO leaderboard_snapshots (user_id, track, scope, city, season_id, xp_value, updated_at)
             SELECT unnest($1::uuid[]), 'main', 'season', NULL, $2::uuid, unnest($3::int[]), NOW()
             ON CONFLICT (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))
             DO UPDATE SET xp_value = EXCLUDED.xp_value, updated_at = NOW()`,
            [seasonUserIds, activeSeason.id, seasonXps]
          ).catch((err: unknown) => errors.push(`dailyLoginXP:leaderboard:season: ${String(err)}`));
        }
      } catch (seasonErr) {
        errors.push(`dailyLoginXP:leaderboard:season: ${String(seasonErr)}`);
      }
    }

    results.dailyLoginXP = {
      usersAwarded,
      xpPerUser: XP_VALUES.daily_login,
    };
  } catch (err) {
    errors.push(`dailyLoginXP: ${String(err)}`);
  }

  // 4. Expire moments — delete rows whose expires_at has passed
  try {
    const [expiredMoments, expiredDmMoments] = await Promise.all([
      db.query<{ count: string }>(
        `WITH deleted AS (
           DELETE FROM moments WHERE expires_at < NOW() RETURNING 1
         )
         SELECT COUNT(*) AS count FROM deleted`
      ),
      db.query<{ count: string }>(
        `WITH deleted AS (
           DELETE FROM messages
           WHERE message_type = 'moment' AND created_at < NOW() - INTERVAL '24 hours'
           RETURNING 1
         )
         SELECT COUNT(*) AS count FROM deleted`
      ),
    ]);
    results.momentsExpiry = {
      expired: parseInt(expiredMoments.rows[0]?.count ?? "0"),
    };
    results.dmMomentsExpiry = {
      expired: parseInt(expiredDmMoments.rows[0]?.count ?? "0"),
    };
  } catch (err) {
    errors.push(`momentsExpiry: ${String(err)}`);
  }

  // 5. Sweep expired coin-purchased message pins
  try {
    const { rowCount } = await db.query(
      `UPDATE room_messages
       SET is_pinned = false, pinned_at = NULL, pinned_by = NULL, pin_expires_at = NULL
       WHERE is_pinned = true
         AND pin_expires_at IS NOT NULL
         AND pin_expires_at <= NOW()`
    );
    results.expiredPinSweep = { unpinned: rowCount ?? 0 };
  } catch (err) {
    errors.push(`expiredPinSweep: ${String(err)}`);
  }

  // 6. Enforce plan-based message history limits — set-based DELETEs
  try {
    const [freeDeleted, plusDeleted] = await Promise.all([
      db.query<{ count: string }>(
        `WITH deleted AS (
           DELETE FROM messages m
           WHERE m.sender_plan_at_creation = 'free'
             AND m.created_at < NOW() - INTERVAL '90 days'
           RETURNING 1
         )
         SELECT COUNT(*)::text AS count FROM deleted`
      ),
      db.query<{ count: string }>(
        `WITH deleted AS (
           DELETE FROM messages m
           WHERE m.sender_plan_at_creation = 'plus'
             AND m.created_at < NOW() - INTERVAL '180 days'
           RETURNING 1
         )
         SELECT COUNT(*)::text AS count FROM deleted`
      ),
    ]);
    results.messageHistoryCleanup = {
      freeDeleted: parseInt(freeDeleted.rows[0]?.count ?? "0", 10),
      plusDeleted: parseInt(plusDeleted.rows[0]?.count ?? "0", 10),
    };
  } catch (err) {
    errors.push(`messageHistoryCleanup: ${String(err)}`);
  }

  return NextResponse.json({
    success: errors.length === 0,
    results,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
  });
};
