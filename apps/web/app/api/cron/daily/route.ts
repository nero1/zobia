/**
 * app/api/cron/daily/route.ts
 *
 * Daily CRON handler (Vercel Hobby Plan — once per day, midnight UTC).
 *
 * Responsibilities:
 *  1. Reset daily quests for all users.
 *  2. Update login streaks (increment for users who logged in today, reset others).
 *  3. Check for inactive users (3 / 7 / 14 / 30 / 90 day re-engagement triggers).
 *  4. Award daily login XP to users who logged in today.
 *  5. Refresh nemesis assignments (Sundays only).
 *  6. Check for season transitions (start / end).
 *
 * Security: Requires `Authorization: Bearer <CRON_SECRET>` header.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resetDailyQuests } from "@/lib/quests/questEngine";
import { refreshNemesisAssignments } from "@/lib/nemesis/nemesisEngine";
import { getCurrentSeason, distributeSeasonRewards, resetSeasonRankings } from "@/lib/seasons/seasonEngine";
import { XP_VALUES } from "@/lib/xp/engine";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Validates the CRON secret from the Authorization header.
 */
function validateCronSecret(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${cronSecret}`;
}

// ---------------------------------------------------------------------------
// Inactivity thresholds (in days)
// ---------------------------------------------------------------------------

const INACTIVITY_TRIGGERS = [3, 7, 14, 30, 90] as const;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Daily CRON job. Must be called once per day at midnight UTC.
 * Protected by CRON_SECRET Bearer token.
 */
export const GET = async (req: NextRequest) => {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  // 1. Reset daily quests
  try {
    const questReset = await resetDailyQuests(db);
    results.questReset = questReset;
  } catch (err) {
    errors.push(`questReset: ${String(err)}`);
  }

  // 2. Update login streaks
  try {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Increment streaks for users who logged in both today and yesterday
    const streakUpdate = await db.query<{ count: string }>(
      `WITH updated AS (
         UPDATE users
         SET login_streak_days = login_streak_days + 1,
             updated_at = NOW()
         WHERE last_login_date = $1
           AND last_active_at::date = $2::date
         RETURNING 1
       )
       SELECT COUNT(*) AS count FROM updated`,
      [yesterday, today]
    );

    // Reset streaks for users who missed a day
    const streakReset = await db.query<{ count: string }>(
      `WITH reset AS (
         UPDATE users
         SET login_streak_days = 0,
             updated_at = NOW()
         WHERE last_login_date < $1
         RETURNING 1
       )
       SELECT COUNT(*) AS count FROM reset`,
      [yesterday]
    );

    results.loginStreaks = {
      incremented: parseInt(streakUpdate.rows[0]?.count ?? "0"),
      reset: parseInt(streakReset.rows[0]?.count ?? "0"),
    };
  } catch (err) {
    errors.push(`loginStreaks: ${String(err)}`);
  }

  // 3. Check inactive users and record re-engagement events
  try {
    const inactivityEvents: Record<number, number> = {};

    for (const days of INACTIVITY_TRIGGERS) {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const oneDayEarlier = new Date(
        Date.now() - (days + 1) * 24 * 60 * 60 * 1000
      ).toISOString();

      // Find users who crossed this inactivity threshold today
      const inactiveResult = await db.query<{ count: string }>(
        `WITH flagged AS (
           INSERT INTO user_inactivity_events (user_id, inactive_days, created_at)
           SELECT id, $1, NOW()
           FROM users
           WHERE deleted_at IS NULL
             AND last_active_at BETWEEN $2 AND $3
             AND NOT EXISTS (
               SELECT 1 FROM user_inactivity_events
               WHERE user_id = users.id AND inactive_days = $1
                 AND created_at > NOW() - INTERVAL '7 days'
             )
           ON CONFLICT DO NOTHING
           RETURNING 1
         )
         SELECT COUNT(*) AS count FROM flagged`,
        [days, oneDayEarlier, cutoff]
      );

      inactivityEvents[days] = parseInt(inactiveResult.rows[0]?.count ?? "0");
    }

    results.inactivityEvents = inactivityEvents;
  } catch (err) {
    errors.push(`inactivityEvents: ${String(err)}`);
  }

  // 4. Award daily login XP to users who logged in today
  try {
    const today = new Date().toISOString().slice(0, 10);

    const loginXpResult = await db.query<{ count: string }>(
      `WITH awarded AS (
         INSERT INTO xp_ledger (user_id, action, xp_amount, multiplier, xp_net, metadata, created_at)
         SELECT id, 'daily_login', $1, 1, $1, $2, NOW()
         FROM users
         WHERE last_active_at::date = NOW()::date
           AND deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM xp_ledger
             WHERE user_id = users.id
               AND action = 'daily_login'
               AND created_at::date = NOW()::date
           )
         RETURNING user_id
       ),
       updated AS (
         UPDATE users
         SET xp_total = xp_total + $1, updated_at = NOW()
         WHERE id IN (SELECT user_id FROM awarded)
         RETURNING 1
       )
       SELECT COUNT(*) AS count FROM awarded`,
      [XP_VALUES.daily_login, JSON.stringify({ date: today })]
    );

    results.dailyLoginXP = {
      usersAwarded: parseInt(loginXpResult.rows[0]?.count ?? "0"),
      xpPerUser: XP_VALUES.daily_login,
    };
  } catch (err) {
    errors.push(`dailyLoginXP: ${String(err)}`);
  }

  // 5. Refresh nemesis assignments (Sundays only)
  try {
    const dayOfWeek = new Date().getDay(); // 0 = Sunday
    if (dayOfWeek === 0) {
      const nemesisResult = await refreshNemesisAssignments(db);
      results.nemesisRefresh = nemesisResult;
    } else {
      results.nemesisRefresh = { skipped: true, reason: "Not Sunday" };
    }
  } catch (err) {
    errors.push(`nemesisRefresh: ${String(err)}`);
  }

  // 6. Check season transitions
  try {
    const seasonTransitions: { ended?: string; upcoming?: string } = {};

    // Check for seasons that just ended
    const endedSeasons = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM seasons
       WHERE is_active = TRUE AND ends_at <= NOW()`,
      []
    );

    for (const season of endedSeasons.rows) {
      try {
        await distributeSeasonRewards(season.id, db);
        await resetSeasonRankings(season.id, db);
        seasonTransitions.ended = season.id;
      } catch (err) {
        errors.push(`seasonEnd(${season.id}): ${String(err)}`);
      }
    }

    // Activate upcoming seasons
    const upcomingSeasons = await db.query<{ id: string }>(
      `UPDATE seasons SET is_active = TRUE, updated_at = NOW()
       WHERE is_active = FALSE AND starts_at <= NOW() AND ends_at > NOW()
       RETURNING id`,
      []
    );

    if (upcomingSeasons.rows[0]) {
      seasonTransitions.upcoming = upcomingSeasons.rows[0].id;
    }

    results.seasonTransitions = seasonTransitions;
  } catch (err) {
    errors.push(`seasonTransitions: ${String(err)}`);
  }

  // 7. Expire moments older than 24 hours
  try {
    const momentsExpired = await db.query<{ count: string }>(
      `WITH expired AS (
         UPDATE moments
         SET expires_at = expires_at  -- mark row as touched; actual expiry is already set
         WHERE expires_at < NOW()
           AND expires_at IS NOT NULL
         RETURNING 1
       )
       SELECT COUNT(*) AS count FROM expired`
    );
    // Because the moments table uses expires_at (not is_expired), we simply
    // delete moments whose expires_at has passed so they are cleaned up.
    const deletedMoments = await db.query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM moments
         WHERE expires_at < NOW()
         RETURNING 1
       )
       SELECT COUNT(*) AS count FROM deleted`
    );
    results.momentsExpiry = {
      expired: parseInt(deletedMoments.rows[0]?.count ?? "0"),
    };
  } catch (err) {
    errors.push(`momentsExpiry: ${String(err)}`);
  }

  // 8. Guild Discovery prompt — notify users who signed up 23–25 hours ago
  //    and have no guild, and haven't already received this notification.
  try {
    const newUsersResult = await db.query<{ id: string }>(
      `SELECT u.id
       FROM users u
       WHERE u.created_at BETWEEN NOW() - INTERVAL '25 hours' AND NOW() - INTERVAL '23 hours'
         AND u.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM guild_members gm WHERE gm.user_id = u.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.user_id = u.id AND n.type = 'guild_discovery'
         )`
    );

    let guildDiscoveryNotified = 0;
    for (const row of newUsersResult.rows) {
      await db.query(
        `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
         VALUES ($1, 'guild_discovery', $2, false, NOW())`,
        [
          row.id,
          JSON.stringify({
            message: "Crews near you are recruiting! Join a Guild to earn XP boosts.",
          }),
        ]
      );
      guildDiscoveryNotified++;
    }

    results.guildDiscoveryPrompts = { notified: guildDiscoveryNotified };
  } catch (err) {
    errors.push(`guildDiscoveryPrompts: ${String(err)}`);
  }

  return NextResponse.json({
    success: errors.length === 0,
    results,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
  });
};
