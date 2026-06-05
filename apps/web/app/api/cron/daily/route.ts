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
import { getCurrentSeason, distributeSeasonRewards, resetSeasonRankings, createSeasonCeremonyRoom } from "@/lib/seasons/seasonEngine";
import { XP_VALUES } from "@/lib/xp/engine";
import { processPendingGiftDrops } from "@/lib/events/monthlyGiftDrop";

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

    // Reset streaks for users who missed a day; preserve last streak for re-engagement gating
    const streakReset = await db.query<{ count: string }>(
      `WITH reset AS (
         UPDATE users
         SET last_streak_before_break = login_streak_days,
             login_streak_days = 0,
             updated_at = NOW()
         WHERE last_login_date < $1
           AND login_streak_days > 0
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

  // 5b. Weekly Season Leaderboard Snapshot (Sundays only — PRD §25)
  //     "Season Leaderboard snapshot published (every Sunday)."
  //     Materialises the current season's top-200 standings into
  //     leaderboard_rank_snapshots with scope='season_weekly'.
  try {
    const dayOfWeekForSnapshot = new Date().getUTCDay(); // 0 = Sunday
    if (dayOfWeekForSnapshot === 0) {
      // Find the currently active season
      const { rows: activeSeasons } = await db.query<{ id: string; name: string }>(
        `SELECT id, name FROM seasons WHERE is_active = TRUE LIMIT 1`
      );

      if (activeSeasons.length > 0) {
        const season = activeSeasons[0];

        // Delete last week's snapshot for this season
        await db.query(
          `DELETE FROM leaderboard_rank_snapshots
           WHERE scope = 'season_weekly' AND season_id = $1`,
          [season.id]
        );

        // Insert fresh snapshot of top-200 season leaderboard
        await db.query(
          `INSERT INTO leaderboard_rank_snapshots
             (user_id, scope, season_id, rank, xp_total, snapshotted_at)
           SELECT
             u.id,
             'season_weekly',
             $1,
             ROW_NUMBER() OVER (ORDER BY sl.season_xp DESC) AS rank,
             sl.season_xp,
             NOW()
           FROM season_leaderboard_entries sl
           JOIN users u ON u.id = sl.user_id
           WHERE sl.season_id = $1
             AND u.deleted_at IS NULL
           ORDER BY sl.season_xp DESC
           LIMIT 200`,
          [season.id]
        );

        results.weeklySeasonSnapshot = { seasonId: season.id, seasonName: season.name, snapshotted: true };
      } else {
        results.weeklySeasonSnapshot = { skipped: true, reason: "No active season" };
      }
    } else {
      results.weeklySeasonSnapshot = { skipped: true, reason: "Not Sunday" };
    }
  } catch (err) {
    errors.push(`weeklySeasonSnapshot: ${String(err)}`);
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
        void createSeasonCeremonyRoom(season.id, season.name, db);
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

    // PRD §5: Also delete Zobia Moment-type DM messages older than 24 hours.
    const deletedDmMoments = await db.query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM messages
         WHERE message_type = 'moment'
           AND created_at < NOW() - INTERVAL '24 hours'
         RETURNING 1
       )
       SELECT COUNT(*) AS count FROM deleted`
    );
    results.dmMomentsExpiry = {
      expired: parseInt(deletedDmMoments.rows[0]?.count ?? "0"),
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

  // 9. Creator Fund distribution (Fridays only)
  const dayOfWeek = new Date().getUTCDay(); // 0=Sun, 5=Fri
  if (dayOfWeek === 5) {
    try {
      const { distributeCreatorFund } = await import('@/lib/creator/fund');
      // Read the fund pool size from x_manifest (admin-configurable)
      const { rows: fundRows } = await db.query<{ value: string }>(
        `SELECT value FROM x_manifest WHERE key = 'creator_fund_balance_kobo' LIMIT 1`
      );
      const poolKobo = parseInt(fundRows[0]?.value ?? "0", 10);
      if (poolKobo > 0) {
        const fundResult = await distributeCreatorFund(poolKobo);
        // Reset the pool to 0 after distribution
        await db.query(
          `INSERT INTO x_manifest (key, value) VALUES ('creator_fund_balance_kobo', '0')
           ON CONFLICT (key) DO UPDATE SET value = '0', updated_at = NOW()`
        );
        results.creatorFundDistribution = { creatorsRewarded: fundResult, poolKobo };
      } else {
        results.creatorFundDistribution = { skipped: true, reason: 'Pool is empty' };
      }
    } catch (err) {
      errors.push(`creatorFund: ${String(err)}`);
    }
  }

  // 12. Guild tier demotion — demote guilds below minimum after 7 days
  try {
    // Minimum member counts per tier base (bronze_1/2/3 = 5, silver_1/2/3 = 15, etc.)
    // PRD §13: Bronze 5–10, Silver 10–15, Gold 15–20, Platinum 20–25, Legend 25+
    // We use the lower bound of each range for demotion — a guild that dips
    // below the lower bound triggers the 7-day recovery window.
    function tierMinMembers(tier: string): number {
      if (tier === 'legend')              return 25;
      if (tier.startsWith('platinum_3')) return 24;
      if (tier.startsWith('platinum_2')) return 22;
      if (tier.startsWith('platinum_1') || tier === 'platinum') return 20;
      if (tier.startsWith('gold_3'))     return 19;
      if (tier.startsWith('gold_2'))     return 17;
      if (tier.startsWith('gold_1') || tier === 'gold') return 15;
      if (tier.startsWith('silver_3'))   return 14;
      if (tier.startsWith('silver_2'))   return 12;
      if (tier.startsWith('silver_1') || tier === 'silver') return 10;
      if (tier.startsWith('bronze_3'))   return 9;
      if (tier.startsWith('bronze_2'))   return 7;
      if (tier.startsWith('bronze_1') || tier === 'bronze') return 5;
      return 0; // unknown tier — no minimum
    }

    // Demotion map: go down one full tier (e.g. gold_1 → silver_3)
    function demotedTier(tier: string): string | null {
      if (tier === 'legend')       return 'platinum_3';
      if (tier.startsWith('platinum')) return 'gold_3';
      if (tier.startsWith('gold'))     return 'silver_3';
      if (tier.startsWith('silver'))   return 'bronze_3';
      return null; // bronze has no demotion
    }

    const { rows: guilds } = await db.query<{
      id: string; captain_id: string; tier: string;
      member_count: number; below_min_since: string | null;
    }>(
      `SELECT g.id, g.captain_id, g.tier, g.member_count, g.below_min_since
       FROM guilds g
       WHERE NOT g.tier LIKE 'bronze%'
         AND g.deleted_at IS NULL`
    );

    let demoted = 0;
    let flagged = 0;
    const now = new Date();

    for (const guild of guilds) {
      const minMembers = tierMinMembers(guild.tier);
      const isBelowMin = guild.member_count < minMembers;
      const newTier = demotedTier(guild.tier);

      if (isBelowMin && !guild.below_min_since) {
        await db.query(
          `UPDATE guilds SET below_min_since = NOW(), updated_at = NOW() WHERE id = $1`,
          [guild.id]
        );
        flagged++;
      } else if (!isBelowMin && guild.below_min_since) {
        await db.query(
          `UPDATE guilds SET below_min_since = NULL, updated_at = NOW() WHERE id = $1`,
          [guild.id]
        );
      } else if (isBelowMin && guild.below_min_since && newTier) {
        const daysBelowMin =
          (now.getTime() - new Date(guild.below_min_since).getTime()) / 86_400_000;
        if (daysBelowMin >= 7) {
          await db.query(
            `UPDATE guilds SET tier = $2, below_min_since = NULL, updated_at = NOW() WHERE id = $1`,
            [guild.id, newTier]
          );
          await db.query(
            `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
             VALUES ($1, 'guild_tier_demoted', $2, false, NOW())`,
            [
              guild.captain_id,
              JSON.stringify({ guildId: guild.id, fromTier: guild.tier, toTier: newTier }),
            ]
          ).catch(() => {});
          demoted++;
        }
      }
    }

    results.guildTierDemotion = { demoted, flagged };
  } catch (err) {
    errors.push(`guildTierDemotion: ${String(err)}`);
  }

  // 13. "The Patron" badge — award to users who are top gifter in 3+ rooms in last 24h
  try {
    // Find users who are the top gifter (by coin_value) in 3+ rooms in the last 24 hours
    const { rows: patronCandidates } = await db.query<{ user_id: string; room_count: string }>(
      `WITH room_totals AS (
         SELECT room_id, sender_id, SUM(coin_value) AS total_coins
         FROM gifts
         WHERE created_at >= NOW() - INTERVAL '24 hours'
           AND room_id IS NOT NULL
         GROUP BY room_id, sender_id
       ),
       top_gifters AS (
         SELECT DISTINCT ON (room_id) room_id, sender_id
         FROM room_totals
         ORDER BY room_id, total_coins DESC
       )
       SELECT sender_id AS user_id, COUNT(*)::text AS room_count
       FROM top_gifters
       GROUP BY sender_id
       HAVING COUNT(*) >= 3`
    );

    let patronAwarded = 0;
    for (const candidate of patronCandidates) {
      await db.query(
        `INSERT INTO user_badges (user_id, badge_type, badge_key, granted_at, awarded_at, metadata)
         VALUES ($1, 'patron', 'patron', NOW(), NOW(), $2)
         ON CONFLICT (user_id, badge_key) DO UPDATE SET granted_at = NOW(), metadata = $2`,
        [
          candidate.user_id,
          JSON.stringify({ roomCount: parseInt(candidate.room_count), awardedAt: new Date().toISOString() }),
        ]
      ).catch(() => {});
      patronAwarded++;
    }

    results.patronBadge = { awarded: patronAwarded };
  } catch (err) {
    errors.push(`patronBadge: ${String(err)}`);
  }

  // 14. Leaderboard ripple notifications — notify users of passive rank changes
  try {
    // Compute current global rankings from leaderboard_snapshots
    const { rows: currentRanks } = await db.query<{
      user_id: string; rank: string; xp_value: string;
    }>(
      `SELECT user_id,
              RANK() OVER (ORDER BY xp_value DESC)::text AS rank,
              xp_value::text
       FROM leaderboard_snapshots
       WHERE track = 'main' AND scope = 'global'
         AND season_id IS NULL`
    );

    let notified = 0;
    for (const current of currentRanks) {
      const currentRank = parseInt(current.rank);

      // Get previous snapshot
      const { rows: prev } = await db.query<{ rank: number; xp: number }>(
        `SELECT rank, xp FROM leaderboard_rank_snapshots
         WHERE user_id = $1 AND scope = 'global'`,
        [current.user_id]
      );

      const prevRank = prev[0]?.rank ?? null;

      if (prevRank !== null && prevRank !== currentRank) {
        const direction = currentRank < prevRank ? 'up' : 'down';
        // Only notify for meaningful passive changes (moved 5+ positions)
        if (Math.abs(prevRank - currentRank) >= 5) {
          await db.query(
            `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
             VALUES ($1, 'rank_change', $2, false, NOW())`,
            [
              current.user_id,
              JSON.stringify({
                direction,
                fromRank: prevRank,
                toRank: currentRank,
              }),
            ]
          ).catch(() => {});
          notified++;
        }
      }

      // Upsert the new snapshot
      await db.query(
        `INSERT INTO leaderboard_rank_snapshots (user_id, scope, rank, xp, snapped_at)
         VALUES ($1, 'global', $2, $3, NOW())
         ON CONFLICT (user_id, scope)
         DO UPDATE SET rank = $2, xp = $3, snapped_at = NOW()`,
        [current.user_id, currentRank, parseInt(current.xp_value)]
      ).catch(() => {});
    }

    results.leaderboardRipple = { notified, snapshotCount: currentRanks.length };
  } catch (err) {
    errors.push(`leaderboardRipple: ${String(err)}`);
  }

  // 10. Platform Council invitation (last 7 days of month)
  try {
    const now = new Date();
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const isLastWeek = now.getUTCDate() >= lastDayOfMonth - 6;

    if (isLastWeek) {
      // Find top 50 by legacy_score not already on council
      const { rows: candidates } = await db.query<{
        id: string; username: string; legacy_score: number;
      }>(
        `SELECT u.id, u.username, u.legacy_score
         FROM users u
         LEFT JOIN platform_council_members pcm ON pcm.user_id = u.id
         WHERE pcm.user_id IS NULL
           AND u.is_active = true
           AND u.login_streak_days > 0
           AND u.prestige_count >= 5
         ORDER BY u.legacy_score DESC
         LIMIT 50`
      );

      let invited = 0;
      for (const candidate of candidates) {
        // Insert council invitation notification
        await db.query(
          `INSERT INTO user_notifications (user_id, type, title, body, metadata, created_at)
           VALUES ($1, 'council_invitation', 'Platform Council Invitation',
             'You are among the top contributors on Zobia. You have been invited to join the Platform Council.',
             $2, NOW())
           ON CONFLICT DO NOTHING`,
          [candidate.id, JSON.stringify({ legacyScore: candidate.legacy_score })]
        );
        invited++;
      }
      results.councilInvitations = { invited };
    }
  } catch (err) {
    errors.push(`councilInvitations: ${String(err)}`);
  }

  // 11. Re-engagement notification dispatch
  try {
    // Find users with inactivity events not yet notified today (include streak for gating)
    const { rows: inactiveUsers } = await db.query<{
      user_id: string;
      days_inactive: number;
      email: string | null;
      last_streak_before_break: number;
    }>(
      `SELECT DISTINCT ON (uie.user_id)
         uie.user_id, uie.inactive_days AS days_inactive,
         u.email,
         COALESCE(u.last_streak_before_break, 0) AS last_streak_before_break
       FROM user_inactivity_events uie
       JOIN users u ON u.id = uie.user_id
       WHERE uie.notified = false
         AND uie.created_at >= NOW() - INTERVAL '25 hours'
       ORDER BY uie.user_id, uie.inactive_days DESC`
    );

    const { getReengagementPayload } = await import('@/lib/notifications/reengagement');
    const { sendPushNotification } = await import('@/lib/notifications/push');
    const { sendEmail } = await import('@/lib/notifications/email');

    // 11a. Credit 200 comeback coins for users who just hit 90-day inactivity threshold
    //      Coins are "reserved" — if the user doesn't log in within 7 days they will be
    //      reversed by the expiry task below.
    const COMEBACK_COIN_AMOUNT = 200;
    for (const user of inactiveUsers) {
      if (user.days_inactive === 90) {
        try {
          await db.transaction(async (tx) => {
            await tx.query(
              `UPDATE users SET coin_balance = COALESCE(coin_balance, 0) + $1, updated_at = NOW()
               WHERE id = $2`,
              [COMEBACK_COIN_AMOUNT, user.user_id]
            );
            await tx.query(
              `INSERT INTO coin_ledger (user_id, amount, type, reference_id, description, created_at)
               VALUES ($1, $2, 'comeback_bonus_reserved',
                 gen_random_uuid(),
                 'Comeback bonus — expires in 7 days if unused',
                 NOW())`,
              [user.user_id, COMEBACK_COIN_AMOUNT]
            );
          });
        } catch {
          // Non-fatal — coin reservation failure must not block notifications
        }
      }
    }

    let dispatched = 0;
    for (const user of inactiveUsers) {
      const payload = await getReengagementPayload(
        user.user_id,
        user.days_inactive,
        user.last_streak_before_break
      );
      if (!payload) continue;

      // Send push notification (fire-and-forget)
      sendPushNotification(user.user_id, payload.title, payload.body, {
        action: payload.action
      }).catch(() => {});

      // Send email notification alongside push (fire-and-forget, non-blocking)
      if (user.email) {
        try {
          sendEmail(
            user.email,
            payload.title,
            payload.body,
            `<p>${payload.body}</p>`
          ).catch(() => {});
        } catch {
          // Non-fatal — email errors must not block other CRON tasks
        }
      }

      // Mark as notified
      await db.query(
        `UPDATE user_inactivity_events
         SET notified = true
         WHERE user_id = $1 AND inactive_days = $2 AND notified = false`,
        [user.user_id, user.days_inactive]
      );
      dispatched++;
    }
    results.reengagementDispatched = { dispatched };
  } catch (err) {
    errors.push(`reengagementDispatch: ${String(err)}`);
  }

  // 15. Monthly gift drop processing
  try {
    const giftDropResult = await processPendingGiftDrops(db);
    results.giftDrops = giftDropResult;
  } catch (err) {
    errors.push(`giftDrops: ${String(err)}`);
  }

  // 16. Mystery XP Drop — fire on a random subset of days each week (PRD §2.1)
  //     Algorithm: generate a deterministic "should drop today" flag based on
  //     today's date and the configured drop frequency (default 3 days/week).
  //     This ensures the drop fires unpredictably but consistently.
  try {
    const { rows: dropFlagRows } = await db.query<{ value: string }>(
      `SELECT value FROM x_manifest WHERE key = 'feature_mystery_xp_drops' LIMIT 1`
    );
    const dropEnabled = (dropFlagRows[0]?.value ?? 'true') === 'true';

    if (dropEnabled) {
      const { rows: batchRows } = await db.query<{ value: string }>(
        `SELECT value FROM x_manifest WHERE key = 'mystery_drop_batch_size' LIMIT 1`
      );
      const { rows: freqRows } = await db.query<{ value: string }>(
        `SELECT value FROM x_manifest WHERE key = 'mystery_drop_days_per_week' LIMIT 1`
      );
      const batchSize = parseInt(batchRows[0]?.value ?? '50', 10);
      const daysPerWeek = Math.min(7, parseInt(freqRows[0]?.value ?? '3', 10));

      // Pseudo-random daily seed: day-of-year modulo 7, fire if seed < daysPerWeek
      const now = new Date();
      const dayOfYear = Math.floor(
        (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86_400_000
      );
      const shouldFireToday = (dayOfYear % 7) < daysPerWeek;

      if (shouldFireToday) {
        const { triggerMysteryXPDrop } = await import('@/lib/mystery/xpDrop');
        const dropResult = await triggerMysteryXPDrop(db, batchSize);

        // Send push notifications to recipients (fire-and-forget)
        const { sendPushNotificationBatch } = await import('@/lib/notifications/push');
        sendPushNotificationBatch(
          dropResult.recipients.map((userId) => ({
            userId,
            title: '⚡ Mystery XP Drop!',
            body: `You just received a surprise XP boost! Log in now to see your progress.`,
            data: { action: '/home', type: 'mystery_xp_drop' },
          }))
        ).catch(() => {});

        results.mysteryXpDrop = {
          fired: true,
          ...dropResult,
        };
      } else {
        results.mysteryXpDrop = { fired: false, reason: 'Not a drop day' };
      }
    } else {
      results.mysteryXpDrop = { fired: false, reason: 'Feature disabled' };
    }
  } catch (err) {
    errors.push(`mysteryXpDrop: ${String(err)}`);
  }

  // 17. Guild Contribution Score alerts (PRD §13)
  //     Members below their guild's rolling 2-week average get a push alert.
  //     If still below average after 2 consecutive weeks, Captain can remove them.
  try {
    const { rows: guilds } = await db.query<{ id: string; captain_id: string }>(
      `SELECT id, captain_id FROM guilds WHERE deleted_at IS NULL AND is_active = TRUE`
    );

    let alertsSent = 0;
    for (const guild of guilds) {
      // Compute average contribution score for this guild's members in the last 14 days
      const { rows: avgRows } = await db.query<{ avg_score: string }>(
        `SELECT AVG(COALESCE(contribution_score, 0))::TEXT AS avg_score
         FROM guild_members
         WHERE guild_id = $1 AND left_at IS NULL`,
        [guild.id]
      );
      const guildAvg = parseFloat(avgRows[0]?.avg_score ?? '0');
      if (guildAvg <= 0) continue;

      // Find members below average
      const { rows: lowScoreMembers } = await db.query<{
        user_id: string;
        contribution_score: number;
      }>(
        `SELECT user_id, COALESCE(contribution_score, 0) AS contribution_score
         FROM guild_members
         WHERE guild_id = $1
           AND left_at IS NULL
           AND COALESCE(contribution_score, 0) < $2`,
        [guild.id, guildAvg * 0.5] // threshold: below 50% of average
      );

      for (const member of lowScoreMembers) {
        // Upsert contribution alert record
        const { rows: alertRows } = await db.query<{ weeks_below: number }>(
          `INSERT INTO guild_contribution_alerts (guild_id, user_id, weeks_below, alerted_at)
           VALUES ($1, $2, 1, NOW())
           ON CONFLICT (guild_id, user_id) DO UPDATE
             SET weeks_below = guild_contribution_alerts.weeks_below + 1,
                 alerted_at = NOW()
           RETURNING weeks_below`,
          [guild.id, member.user_id]
        );

        const weeksBelowCount = alertRows[0]?.weeks_below ?? 1;

        // Send notification to the member
        await db.query(
          `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
           VALUES ($1, 'guild_low_contribution', $2, false, NOW())`,
          [
            member.user_id,
            JSON.stringify({
              guildId: guild.id,
              contributionScore: member.contribution_score,
              guildAverage: Math.round(guildAvg),
              weeksBelow: weeksBelowCount,
            }),
          ]
        ).catch(() => {});

        alertsSent++;
      }

      // Reset the alert counter for members who improved
      await db.query(
        `DELETE FROM guild_contribution_alerts
         WHERE guild_id = $1
           AND user_id NOT IN (
             SELECT user_id FROM guild_members
             WHERE guild_id = $1
               AND left_at IS NULL
               AND COALESCE(contribution_score, 0) < $2
           )`,
        [guild.id, guildAvg * 0.5]
      ).catch(() => {});
    }

    results.guildContributionAlerts = { alertsSent };
  } catch (err) {
    errors.push(`guildContributionAlerts: ${String(err)}`);
  }

  // 18. DM Conversation Score sticker unlocks (PRD §5)
  //     When a conversation score hits a milestone (e.g. 7-day streak = 50 score),
  //     unlock exclusive DM sticker reactions for both participants.
  try {
    const STICKER_UNLOCK_MILESTONES = [50, 100, 200, 365];

    const { rows: conversations } = await db.query<{
      user_id_1: string;
      user_id_2: string;
      score: number;
    }>(
      `SELECT user_id_1, user_id_2, score
       FROM dm_conversation_scores
       WHERE score >= $1`,
      [STICKER_UNLOCK_MILESTONES[0]]
    );

    let stickerUnlocks = 0;
    for (const convo of conversations) {
      for (const milestone of STICKER_UNLOCK_MILESTONES) {
        if (convo.score < milestone) break;

        // Check if this milestone has already been awarded
        const { rows: existing } = await db.query<{ id: string }>(
          `SELECT id FROM dm_conversation_score_milestones
           WHERE user_id_a = $1 AND user_id_b = $2 AND milestone_score = $3
           LIMIT 1`,
          [convo.user_id_1, convo.user_id_2, milestone]
        );
        if (existing.length > 0) continue;

        // Award — insert milestone record and unlock reaction sets for both users
        await db.query(
          `INSERT INTO dm_conversation_score_milestones
             (user_id_a, user_id_b, milestone_score, awarded_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT DO NOTHING`,
          [convo.user_id_1, convo.user_id_2, milestone]
        ).catch(() => {});

        // Notify both participants
        for (const uid of [convo.user_id_1, convo.user_id_2]) {
          await db.query(
            `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
             VALUES ($1, 'dm_sticker_unlock', $2, false, NOW())`,
            [
              uid,
              JSON.stringify({
                milestone,
                otherUserId: uid === convo.user_id_1 ? convo.user_id_2 : convo.user_id_1,
                message: `Your ${milestone}-day conversation streak unlocked exclusive sticker reactions!`,
              }),
            ]
          ).catch(() => {});
        }

        stickerUnlocks++;
      }
    }

    results.stickerUnlocks = { unlocked: stickerUnlocks };
  } catch (err) {
    errors.push(`stickerUnlocks: ${String(err)}`);
  }

  // 19. Telegram re-engagement cross-delivery (PRD §20)
  //     For re-engaged users who have a Telegram account linked, also send
  //     the re-engagement message via Telegram DM.
  try {
    const { rows: telegramUsers } = await db.query<{
      user_id: string;
      telegram_id: string;
      days_inactive: number;
      last_streak_before_break: number;
    }>(
      `SELECT DISTINCT ON (uie.user_id)
         uie.user_id,
         u.telegram_id,
         uie.inactive_days AS days_inactive,
         COALESCE(u.last_streak_before_break, 0) AS last_streak_before_break
       FROM user_inactivity_events uie
       JOIN users u ON u.id = uie.user_id
       WHERE uie.notified = false
         AND uie.created_at >= NOW() - INTERVAL '25 hours'
         AND u.telegram_id IS NOT NULL
         AND u.deleted_at IS NULL
       ORDER BY uie.user_id, uie.inactive_days DESC`
    );

    const { getReengagementPayload } = await import('@/lib/notifications/reengagement');
    const { sendTelegramMessage } = await import('@/lib/notifications/telegram');

    let telegramSent = 0;
    for (const user of telegramUsers) {
      const payload = await getReengagementPayload(
        user.user_id,
        user.days_inactive,
        user.last_streak_before_break
      );
      if (!payload) continue;

      sendTelegramMessage(
        user.telegram_id,
        `<b>${payload.title}</b>\n\n${payload.body}`
      );
      telegramSent++;
    }

    results.telegramReengagement = { sent: telegramSent };
  } catch (err) {
    errors.push(`telegramReengagement: ${String(err)}`);
  }

  // 20. Trust Score daily recalculation for active users (PRD §19)
  //     Recalculate trust scores for users who have had trust-affecting events
  //     in the last 24 hours (reports received, payments, warnings, bans lifted).
  try {
    const { calculateTrustScore } = await import('@/lib/trust/trustScore');

    const { rows: staleUsers } = await db.query<{ id: string }>(
      `SELECT DISTINCT u.id
       FROM users u
       WHERE u.deleted_at IS NULL
         AND (
           -- Users with recent reports against them
           EXISTS (
             SELECT 1 FROM reports r
             WHERE r.reported_user_id = u.id
               AND r.created_at >= NOW() - INTERVAL '24 hours'
           )
           OR
           -- Users with recent payments
           EXISTS (
             SELECT 1 FROM payments p
             WHERE p.user_id = u.id
               AND p.status = 'success'
               AND p.created_at >= NOW() - INTERVAL '24 hours'
           )
           OR
           -- Users with recent moderation actions
           EXISTS (
             SELECT 1 FROM moderation_actions ma
             WHERE ma.target_user_id = u.id
               AND ma.created_at >= NOW() - INTERVAL '24 hours'
           )
         )
       LIMIT 500`
    );

    let trustUpdated = 0;
    for (const user of staleUsers) {
      try {
        await calculateTrustScore(user.id, db);
        trustUpdated++;
      } catch {
        // Non-fatal
      }
    }

    results.trustScoreUpdates = { updated: trustUpdated };
  } catch (err) {
    errors.push(`trustScoreUpdates: ${String(err)}`);
  }

  // 21. Monthly coin bonus for paid plan users (runs on 1st of each month only)
  // PRD §3: Plus=50 coins, Pro=200 coins, Max=500 coins per month.
  // Each plan is processed in a single atomic transaction: ledger INSERT +
  // balance UPDATE happen together so no partial write can occur (PRD §18).
  try {
    const today = new Date();
    if (today.getDate() === 1) {
      const PLAN_MONTHLY_BONUS: Record<string, number> = { plus: 50, pro: 200, max: 500 };
      let totalAwarded = 0;

      for (const [plan, bonus] of Object.entries(PLAN_MONTHLY_BONUS)) {
        await db.transaction(async (tx) => {
          // Credit ledger and balance atomically; skip users already credited today
          // (idempotency: ON CONFLICT DO NOTHING on the unique ledger reference).
          await tx.query(
            `WITH eligible AS (
               SELECT id FROM users
               WHERE plan = $1
                 AND is_active = true
                 AND deleted_at IS NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM coin_ledger
                   WHERE user_id = users.id
                     AND type = 'monthly_plan_bonus'
                     AND created_at::date = CURRENT_DATE
                 )
             ),
             ledger_rows AS (
               INSERT INTO coin_ledger
                 (user_id, amount, type, reference_id, description, created_at)
               SELECT id, $2, 'monthly_plan_bonus', gen_random_uuid(),
                      $3, NOW()
               FROM eligible
               RETURNING user_id
             )
             UPDATE users
             SET coin_balance = coin_balance + $2,
                 updated_at = NOW()
             WHERE id IN (SELECT user_id FROM ledger_rows)`,
            [plan, bonus, `Monthly ${plan} plan bonus`]
          );
        });
        totalAwarded++;
      }

      results.monthlyPlanBonus = { ran: true, plansProcessed: totalAwarded, date: today.toISOString() };
    } else {
      results.monthlyPlanBonus = { ran: false, reason: "Not the 1st of the month" };
    }
  } catch (err) {
    errors.push(`monthlyPlanBonus: ${String(err)}`);
  }

  // 22. Expire unclaimed 90-day comeback coin reservations (7-day window)
  //     Users who received the comeback bonus but never logged in within 7 days
  //     have their reserved coins reversed to keep economy consistent.
  try {
    const COMEBACK_COIN_AMOUNT = 200;

    // Find users with a comeback_bonus_reserved entry older than 7 days
    // who have NOT logged in since the bonus was issued
    const { rows: expiredBonusUsers } = await db.query<{
      user_id: string;
      ledger_id: string;
      bonus_granted_at: string;
    }>(
      `SELECT cl.user_id, cl.id AS ledger_id, cl.created_at AS bonus_granted_at
       FROM coin_ledger cl
       JOIN users u ON u.id = cl.user_id
       WHERE cl.type = 'comeback_bonus_reserved'
         AND cl.created_at < NOW() - INTERVAL '7 days'
         AND NOT EXISTS (
           SELECT 1 FROM coin_ledger cl2
           WHERE cl2.user_id = cl.user_id
             AND cl2.type = 'comeback_bonus_claimed'
             AND cl2.created_at > cl.created_at
         )
         AND (u.last_active_at IS NULL OR u.last_active_at < cl.created_at)
         AND u.deleted_at IS NULL`
    );

    let expiredBonuses = 0;
    for (const row of expiredBonusUsers) {
      try {
        await db.transaction(async (tx) => {
          await tx.query(
            `UPDATE users
             SET coin_balance = GREATEST(COALESCE(coin_balance, 0) - $1, 0),
                 updated_at = NOW()
             WHERE id = $2`,
            [COMEBACK_COIN_AMOUNT, row.user_id]
          );
          await tx.query(
            `INSERT INTO coin_ledger (user_id, amount, type, reference_id, description, created_at)
             VALUES ($1, $2, 'comeback_bonus_expired',
               gen_random_uuid(),
               'Comeback bonus expired (7-day window passed)',
               NOW())`,
            [row.user_id, -COMEBACK_COIN_AMOUNT]
          );
        });
        expiredBonuses++;
      } catch {
        // Non-fatal
      }
    }

    results.comebackBonusExpiry = { expired: expiredBonuses };
  } catch (err) {
    errors.push(`comebackBonusExpiry: ${String(err)}`);
  }

  // 23. Weekly Guild Quest reset (Mondays only — PRD §13)
  //     Creates a fresh set of collective challenges for every active guild.
  //     Previous week's quests are marked inactive so historical data is preserved.
  try {
    const today = new Date();
    const isMonday = today.getUTCDay() === 1;

    if (isMonday) {
      // Calculate the start (today) and end (next Sunday) of the new quest week
      const weekStart = today.toISOString().slice(0, 10);
      const weekEndDate = new Date(today);
      weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
      const weekEnd = weekEndDate.toISOString().slice(0, 10);

      // Template quests per PRD §13 — admin can extend these via the DB
      const GUILD_QUEST_TEMPLATES = [
        {
          title: "Send 1,000 messages this week",
          description: "Collectively send a combined 1,000 messages across all Guild members.",
          quest_type: "total_messages",
          target_count: 1000,
          xp_reward: 500,
          coin_reward: 200,
        },
        {
          title: "10+ members complete daily quests 3 days in a row",
          description: "Have at least 10 different members each complete their daily quest deck on 3 consecutive days.",
          quest_type: "daily_quest_streaks",
          target_count: 10,
          xp_reward: 750,
          coin_reward: 300,
        },
        {
          title: "Gift 5,000 coins to non-Guild members",
          description: "Collectively gift at least 5,000 coins to users outside your Guild.",
          quest_type: "external_gifts",
          target_count: 5000,
          xp_reward: 600,
          coin_reward: 250,
        },
      ];

      // Get all active guilds
      const { rows: guilds } = await db.query<{ id: string }>(
        `SELECT id FROM guilds WHERE deleted_at IS NULL AND is_active = TRUE`
      );

      let guildQuestsCreated = 0;

      for (const guild of guilds) {
        // Mark last week's quests as inactive (soft-expire without deleting)
        await db.query(
          `UPDATE guild_quests
           SET completed = CASE WHEN completed THEN completed ELSE false END,
               updated_at = NOW()
           WHERE guild_id = $1
             AND week_end < $2
             AND completed = false`,
          [guild.id, weekStart]
        ).catch(() => {});

        // Create the new week's quests for this guild (skip if already created)
        for (const template of GUILD_QUEST_TEMPLATES) {
          await db.query(
            `INSERT INTO guild_quests
               (guild_id, title, description, quest_type, target_count,
                current_progress, xp_reward, coin_reward,
                week_start, week_end, completed, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, false, NOW(), NOW())
             ON CONFLICT DO NOTHING`,
            [
              guild.id,
              template.title,
              template.description,
              template.quest_type,
              template.target_count,
              template.xp_reward,
              template.coin_reward,
              weekStart,
              weekEnd,
            ]
          ).catch(() => {});
          guildQuestsCreated++;
        }

        // Notify guild captain + veterans about new weekly quests
        await db.query(
          `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
           SELECT gm.user_id,
                  'guild_quests_reset',
                  jsonb_build_object('guildId', $1::text, 'weekStart', $2::text),
                  false,
                  NOW()
           FROM guild_members gm
           WHERE gm.guild_id = $1
             AND gm.left_at IS NULL
             AND gm.role IN ('captain', 'veteran')`,
          [guild.id, weekStart]
        ).catch(() => {});
      }

      results.guildQuestReset = {
        ran: true,
        guildsProcessed: guilds.length,
        questsCreated: guildQuestsCreated,
        weekStart,
        weekEnd,
      };
    } else {
      results.guildQuestReset = { ran: false, reason: "Not Monday" };
    }
  } catch (err) {
    errors.push(`guildQuestReset: ${String(err)}`);
  }

  // 24. Flash XP event lifecycle — announce, fire, expire (PRD §2.4)
  // Events in flash_xp_events have three transitions:
  //   announced_at reached → send push notifications to all users
  //   fires_at reached     → set fired=true (XP engine starts applying multiplier)
  //   ends_at reached      → set is_active=false (multiplier stops)
  try {
    interface FlashXpRow {
      id: string;
      name: string;
      multiplier: string;
      announced_at: string;
      fires_at: string;
      ends_at: string;
      is_active: boolean;
      fired: boolean;
    }

    // Fetch all events that are still active or have passed their fires_at
    const { rows: flashRows } = await db.query<FlashXpRow>(
      `SELECT id, name, multiplier::TEXT AS multiplier,
              announced_at, fires_at, ends_at, is_active, fired
       FROM flash_xp_events
       WHERE is_active = TRUE OR (is_active = FALSE AND fired = FALSE AND fires_at <= NOW())`
    );

    let flashAnnounced = 0;
    let flashFired = 0;
    let flashExpired = 0;

    for (const evt of flashRows) {
      const now = Date.now();
      const announcedAt = new Date(evt.announced_at).getTime();
      const firesAt = new Date(evt.fires_at).getTime();
      const endsAt = new Date(evt.ends_at).getTime();

      // Announce: announced_at reached but not yet fired — send notifications once
      if (now >= announcedAt && !evt.fired && evt.is_active) {
        // Check if we already sent announcement notifications for this event
        const { rows: notifCheck } = await db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM notifications
           WHERE type = 'flash_xp_announced' AND payload->>'eventId' = $1 LIMIT 1`,
          [evt.id]
        ).catch(() => ({ rows: [{ count: "1" }] }));

        if (parseInt(notifCheck[0]?.count ?? "1", 10) === 0) {
          // Notify all active users
          await db.query(
            `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
             SELECT id,
                    'flash_xp_announced',
                    jsonb_build_object(
                      'eventId', $1::text,
                      'eventName', $2::text,
                      'multiplier', $3::text,
                      'firesAt', $4::text,
                      'endsAt', $5::text
                    ),
                    false,
                    NOW()
             FROM users
             WHERE deleted_at IS NULL
               AND last_active_at > NOW() - INTERVAL '7 days'`,
            [evt.id, evt.name, evt.multiplier, evt.fires_at, evt.ends_at]
          ).catch(() => {});
          flashAnnounced++;
        }
      }

      // Activate: fires_at reached and not yet fired
      // Also sync into platform_events so the events calendar shows it
      if (now >= firesAt && !evt.fired) {
        await db.query(
          `UPDATE flash_xp_events SET fired = TRUE, updated_at = NOW() WHERE id = $1`,
          [evt.id]
        ).catch(() => {});
        // Upsert into platform_events so events calendar reflects it
        await db.query(
          `INSERT INTO platform_events
             (name, description, event_type, xp_multiplier, starts_at, ends_at, is_active, metadata, created_at, updated_at)
           VALUES ($1, 'Double XP event', 'flash_xp', $2::numeric, $3, $4, TRUE, jsonb_build_object('source_flash_xp_id', $5::text), NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [evt.name, evt.multiplier, evt.fires_at, evt.ends_at, evt.id]
        ).catch(() => {});
        flashFired++;
      }

      // Expire: ends_at reached
      if (now >= endsAt && evt.is_active) {
        await db.query(
          `UPDATE flash_xp_events SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
          [evt.id]
        ).catch(() => {});
        flashExpired++;
      }
    }

    results.flashXpLifecycle = { announced: flashAnnounced, fired: flashFired, expired: flashExpired };
  } catch (err) {
    errors.push(`flashXpLifecycle: ${String(err)}`);
  }

  // ── Step 23: Enforce plan-based message history limits (PRD §3) ─────────────
  // Free  = 90 days  |  Plus = 180 days  |  Pro/Max = Unlimited
  // We hard-delete messages (DMs and group messages) sent by users whose plan
  // puts a cap on how far back history is retained.  The cutoff is applied to
  // the SENDER's current plan at the time the CRON runs.
  try {
    // DM messages: delete from the messages table rows older than plan limit
    const freeDeleted = await db.query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM messages m
         USING users u
         WHERE m.sender_id = u.id
           AND u.plan = 'free'
           AND m.created_at < NOW() - INTERVAL '90 days'
         RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM deleted`
    );

    const plusDeleted = await db.query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM messages m
         USING users u
         WHERE m.sender_id = u.id
           AND u.plan = 'plus'
           AND m.created_at < NOW() - INTERVAL '180 days'
         RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM deleted`
    );

    results.messageHistoryCleanup = {
      freeDeleted: parseInt(freeDeleted.rows[0]?.count ?? "0", 10),
      plusDeleted: parseInt(plusDeleted.rows[0]?.count ?? "0", 10),
    };
  } catch (err) {
    errors.push(`messageHistoryCleanup: ${String(err)}`);
  }

  // 26. Annual cultural event recurrence (PRD §25)
  //     For each recurring annual event whose current year's instance has ended,
  //     clone it into next year if no future instance already exists.
  try {
    interface RecurringEventRow {
      id: string;
      name: string;
      description: string;
      event_type: string;
      xp_multiplier: string;
      metadata: string;
      starts_at: string;
      ends_at: string;
      recurrence_anchor_month_start: number;
      recurrence_anchor_day_start: number;
      recurrence_anchor_month_end: number;
      recurrence_anchor_day_end: number;
    }

    const { rows: recurringEvents } = await db.query<RecurringEventRow>(
      `SELECT id, name, description, event_type, xp_multiplier::TEXT AS xp_multiplier,
              metadata::TEXT AS metadata, starts_at::TEXT AS starts_at, ends_at::TEXT AS ends_at,
              recurrence_anchor_month_start, recurrence_anchor_day_start,
              recurrence_anchor_month_end, recurrence_anchor_day_end
       FROM platform_events
       WHERE is_recurring_annual = TRUE
         AND ends_at < NOW()
         AND is_active = TRUE`
    );

    let eventsCloned = 0;
    const nextYear = new Date().getUTCFullYear() + 1;

    for (const evt of recurringEvents) {
      // Check if a future clone already exists for next year
      const { rows: futureCheck } = await db.query<{ count: string }>(
        `SELECT COUNT(*)::TEXT AS count
         FROM platform_events
         WHERE name = $1
           AND EXTRACT(YEAR FROM starts_at) >= $2`,
        [evt.name, nextYear]
      );
      if (parseInt(futureCheck[0]?.count ?? "0", 10) > 0) continue;

      // Project into next year using anchor month/day
      const msStart = evt.recurrence_anchor_month_start;
      const dsStart = evt.recurrence_anchor_day_start;
      const msEnd   = evt.recurrence_anchor_month_end;
      const dsEnd   = evt.recurrence_anchor_day_end;

      // If end month is earlier than start month the event crosses a year boundary
      const endYear = msEnd < msStart ? nextYear + 1 : nextYear;

      const newStartsAt = `${nextYear}-${String(msStart).padStart(2, '0')}-${String(dsStart).padStart(2, '0')} 00:00:00+00`;
      const newEndsAt   = `${endYear}-${String(msEnd).padStart(2, '0')}-${String(dsEnd).padStart(2, '0')} 23:59:59+00`;

      await db.query(
        `INSERT INTO platform_events
           (name, description, event_type, xp_multiplier, starts_at, ends_at,
            metadata, is_recurring_annual,
            recurrence_anchor_month_start, recurrence_anchor_day_start,
            recurrence_anchor_month_end, recurrence_anchor_day_end,
            is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, TRUE, $8, $9, $10, $11, TRUE)
         ON CONFLICT DO NOTHING`,
        [
          evt.name, evt.description, evt.event_type,
          parseFloat(evt.xp_multiplier),
          newStartsAt, newEndsAt,
          evt.metadata ?? '{}',
          msStart, dsStart, msEnd, dsEnd,
        ]
      );
      eventsCloned++;
    }

    results.annualEventRecurrence = { eventsCloned, targetYear: nextYear };
  } catch (err) {
    errors.push(`annualEventRecurrence: ${String(err)}`);
  }

  return NextResponse.json({
    success: errors.length === 0,
    results,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
  });
};
