export const dynamic = 'force-dynamic';

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
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// INFRA-01: Graceful shutdown on SIGTERM
// ---------------------------------------------------------------------------

let _shuttingDown = false;

if (typeof process !== "undefined") {
  process.once("SIGTERM", () => {
    _shuttingDown = true;
    console.warn("[cron/daily] SIGTERM received — completing current task then exiting");
    // Allow up to 10 seconds for in-flight DB queries to complete before hard exit
    setTimeout(() => {
      console.error("[cron/daily] Graceful shutdown timeout exceeded — forcing exit");
      process.exit(0);
    }, 10_000).unref();
  });
}
import { resetDailyQuests } from "@/lib/quests/questEngine";
import { refreshNemesisAssignments } from "@/lib/nemesis/nemesisEngine";
import { getCurrentSeason, distributeSeasonRewards, resetSeasonRankings, createSeasonCeremonyRoom } from "@/lib/seasons/seasonEngine";
import { XP_VALUES } from "@/lib/xp/engine";
import { processPendingGiftDrops } from "@/lib/events/monthlyGiftDrop";
import { sendBulkTelegramMessages } from "@/lib/notifications/telegram";
import { retryFailedXPAwards } from "@/lib/xp/safeAwardXP";
import { getAllCircuitMetrics } from "@/lib/payments/circuit";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function isValidSecret(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Validates the CRON secret from the Authorization header.
 */
function validateCronSecret(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  return isValidSecret(token, cronSecret);
}

// ---------------------------------------------------------------------------
// Inactivity thresholds (in days)
// ---------------------------------------------------------------------------

const INACTIVITY_TRIGGERS = [3, 7, 14, 30, 90] as const;

const COMEBACK_COIN_AMOUNT = 200;

// ---------------------------------------------------------------------------
// CRON-GUILD-01: Single source of truth for all guild tier thresholds.
// Used by both the demotion step (minMembers) and the promotion step (promotionXP, next).
// ---------------------------------------------------------------------------

const GUILD_TIERS = [
  { name: 'bronze_1',   minMembers: 5,  promotionXP: 1_000,   next: 'bronze_2'   as string | null },
  { name: 'bronze_2',   minMembers: 7,  promotionXP: 2_500,   next: 'bronze_3'   as string | null },
  { name: 'bronze_3',   minMembers: 9,  promotionXP: 5_000,   next: 'silver_1'   as string | null },
  { name: 'silver_1',   minMembers: 10, promotionXP: 10_000,  next: 'silver_2'   as string | null },
  { name: 'silver_2',   minMembers: 12, promotionXP: 20_000,  next: 'silver_3'   as string | null },
  { name: 'silver_3',   minMembers: 14, promotionXP: 35_000,  next: 'gold_1'     as string | null },
  { name: 'gold_1',     minMembers: 15, promotionXP: 50_000,  next: 'gold_2'     as string | null },
  { name: 'gold_2',     minMembers: 17, promotionXP: 75_000,  next: 'gold_3'     as string | null },
  { name: 'gold_3',     minMembers: 19, promotionXP: 100_000, next: 'platinum_1' as string | null },
  { name: 'platinum_1', minMembers: 20, promotionXP: 150_000, next: 'platinum_2' as string | null },
  { name: 'platinum_2', minMembers: 22, promotionXP: 200_000, next: 'platinum_3' as string | null },
  { name: 'platinum_3', minMembers: 24, promotionXP: 300_000, next: 'legend'     as string | null },
  { name: 'legend',     minMembers: 25, promotionXP: Infinity, next: null },
];

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

  if (_shuttingDown) {
    return NextResponse.json({ error: "Server shutting down" }, { status: 503 });
  }

  // CRON-IDEMPOTENCY-01: Prevent duplicate runs on the same UTC day.
  // Uses cron_state row as a mutex: the conditional UPDATE only succeeds if
  // last-run date has changed. rowCount=0 means another invocation already ran today.
  const cronRunDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  try {
    const { rowCount: guardCount } = await db.query(
      `INSERT INTO cron_state (key, value_ts, updated_at)
       VALUES ('daily_cron_last_run', $1::date::timestamptz, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value_ts = $1::date::timestamptz, updated_at = NOW()
         WHERE cron_state.value_ts < $1::date::timestamptz`,
      [cronRunDate]
    );
    if ((guardCount ?? 0) === 0) {
      console.info(`[cron/daily] Already ran for ${cronRunDate} — skipping duplicate invocation`);
      return NextResponse.json({ skipped: true, reason: 'Already ran today', date: cronRunDate });
    }
  } catch (guardErr) {
    // Non-fatal: proceed rather than silently skip if cron_state is unavailable
    console.error('[cron/daily] Run-guard check failed:', guardErr);
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

    // Increment streaks for users who logged in yesterday (not today — the CRON
    // runs at midnight UTC so "today's" login_date hasn't been recorded yet).
    // Uses last_login_date (date column, indexed) rather than casting
    // last_login_at::date which cannot use the index (CRON-STREAK-02).
    // Also updates login_streak to keep it in sync with login_streak_days (CRON-STREAK-01).
    const streakUpdate = await db.query<{ count: string }>(
      `WITH updated AS (
         UPDATE users
         SET login_streak_days = login_streak_days + 1,
             login_streak = login_streak_days + 1,
             updated_at = NOW()
         WHERE last_login_date = CURRENT_DATE - 1
         RETURNING 1
       )
       SELECT COUNT(*) AS count FROM updated`,
      []
    );

    // Reset streaks for users who missed a day; preserve last streak for re-engagement gating.
    // Also updates longest_streak when the broken streak is a new record (SCHEMA-STREAK-01).
    const streakReset = await db.query<{ count: string }>(
      `WITH reset AS (
         UPDATE users
         SET last_streak_before_break = login_streak_days,
             longest_streak = GREATEST(COALESCE(longest_streak, 0), login_streak_days),
             login_streak_days = 0,
             login_streak = 0,
             updated_at = NOW()
         WHERE last_login_date < CURRENT_DATE - 1
           AND login_streak_days > 0
         RETURNING 1
       )
       SELECT COUNT(*) AS count FROM reset`
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
         INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, base_amount, created_at)
         SELECT id, $1, 'main', 'daily_login',
                'daily_login:' || id::text || ':' || CURRENT_DATE::text,
                $1, NOW()
         FROM users
         WHERE last_login_date = CURRENT_DATE - 1
           AND deleted_at IS NULL
         ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
         RETURNING user_id
       ),
       updated AS (
         UPDATE users
         SET xp_total = xp_total + $1, updated_at = NOW()
         WHERE id IN (SELECT user_id FROM awarded)
         RETURNING 1
       )
       SELECT COUNT(*) AS count FROM awarded`,
      [XP_VALUES.daily_login]
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
      const { rows: activeSeasons } = await db.query<{ id: string; name: string; starts_at: string }>(
        `SELECT id, name, starts_at FROM seasons WHERE is_active = TRUE LIMIT 1`
      );

      if (activeSeasons.length > 0) {
        const season = activeSeasons[0];

        // Encode the season into the scope value so historical snapshots are
        // preserved (BUG-07: the table has no season_id column).
        const seasonScope = `season:${season.id}`;

        // Delete last week's snapshot for this season scope
        await db.query(
          `DELETE FROM leaderboard_rank_snapshots
           WHERE scope = $1`,
          [seasonScope]
        );

        // Insert fresh snapshot of top-200 season leaderboard.
        // Uses leaderboard_snapshots (the materialised table) filtered to season scope.
        // Columns used: user_id, scope, rank, xp, snapped_at (BUG-07: season_id,
        // xp_total, snapshotted_at do not exist in this table).
        await db.query(
          `INSERT INTO leaderboard_rank_snapshots
             (user_id, scope, rank, xp, snapped_at)
           SELECT
             ls.user_id,
             $2,
             ROW_NUMBER() OVER (ORDER BY ls.xp_value DESC) AS rank,
             ls.xp_value,
             NOW()
           FROM leaderboard_snapshots ls
           JOIN users u ON u.id = ls.user_id
           WHERE ls.season_id = $1
             AND ls.scope = 'season'
             AND u.deleted_at IS NULL
           ORDER BY ls.xp_value DESC
           LIMIT 200
           ON CONFLICT (user_id, scope)
           DO UPDATE SET rank = EXCLUDED.rank, xp = EXCLUDED.xp, snapped_at = EXCLUDED.snapped_at`,
          [season.id, seasonScope]
        );

        // Award season_top100_frame badge to ranks 11-100 during weeks 6-7 (PRD §8)
        // BUG-39: The only unique index on user_badges is (user_id, badge_key) WHERE
        // badge_key IS NOT NULL — there is no (user_id, badge_type, reference_id) index.
        try {
          const seasonStartTime = new Date(season.starts_at).getTime();
          const weekNum = Math.ceil((Date.now() - seasonStartTime) / (7 * 24 * 60 * 60 * 1000));

          if (weekNum >= 6) {
            await db.query(
              `INSERT INTO user_badges (user_id, badge_type, badge_key, reference_id, awarded_at)
               SELECT ls.user_id, 'season_top100_frame', 'season_top100_frame:s' || $1::text, $1, NOW()
               FROM (
                 SELECT ls.user_id, ROW_NUMBER() OVER (ORDER BY ls.xp_value DESC) AS rank
                 FROM leaderboard_snapshots ls
                 JOIN users u ON u.id = ls.user_id
                 WHERE ls.season_id = $1
                   AND ls.scope = 'season'
                   AND u.deleted_at IS NULL
               ) ls
               WHERE ls.rank BETWEEN 11 AND 100
               ON CONFLICT (user_id, badge_key) WHERE badge_key IS NOT NULL DO NOTHING`,
              [season.id]
            );
          }
        } catch (err) {
          console.error('[cron] Failed to award season_top100_frame badges:', err);
        }

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
    const seasonTransitions: { ended?: string[]; upcoming?: string } = {};

    // Check for seasons that just ended
    const endedSeasons = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM seasons
       WHERE is_active = TRUE AND ends_at <= NOW()`,
      []
    );

    for (const season of endedSeasons.rows) {
      try {
        await resetSeasonRankings(season.id, db);
        await distributeSeasonRewards(season.id, db);
        try {
          await createSeasonCeremonyRoom(season.id, season.name, db);
        } catch (err) {
          console.error('[cron] createSeasonCeremonyRoom failed for season', season.id, err);
        }
        if (!seasonTransitions.ended) seasonTransitions.ended = [];
        seasonTransitions.ended.push(season.id);
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
        `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
         VALUES ($1, 'guild_discovery', $2, $3, $4, false, NOW())`,
        [
          row.id,
          "Join a Guild",
          "Crews near you are recruiting! Join a Guild to earn XP boosts.",
          JSON.stringify({}),
        ]
      );
      guildDiscoveryNotified++;
    }

    results.guildDiscoveryPrompts = { notified: guildDiscoveryNotified };
  } catch (err) {
    errors.push(`guildDiscoveryPrompts: ${String(err)}`);
  }

  // 9. Creator Fund — two-step monthly cycle:
  //    Day 1: Seed the pool from the previous month's ad revenue (5% of earnings).
  //    Day 5: Distribute the pool to eligible creators and reset to 0.
  const nowDate = new Date();
  const utcDay = nowDate.getUTCDate();

  if (utcDay === 1) {
    // Day 1 — Seed the Creator Fund pool from prior month's ad revenue (5%)
    try {
      const prevMonth = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - 1, 1));
      const prevMonthKey = `ad_revenue_${prevMonth.getUTCFullYear()}_${String(prevMonth.getUTCMonth() + 1).padStart(2, '0')}_kobo`;

      const { rows: revenueRows } = await db.query<{ value: string }>(
        `SELECT value FROM x_manifest WHERE key = $1 LIMIT 1`,
        [prevMonthKey]
      );
      const prevMonthRevenueKobo = parseInt(revenueRows[0]?.value ?? "0", 10);
      const newPoolKobo = Math.floor(prevMonthRevenueKobo * 0.05);

      // Accumulate seed into the existing balance rather than overwriting it —
      // the webhook handler adds 5% of each payment throughout the month.
      await db.query(
        `INSERT INTO x_manifest (key, value) VALUES ('creator_fund_balance_kobo', $1::text)
         ON CONFLICT (key) DO UPDATE
           SET value = (COALESCE(x_manifest.value::NUMERIC, 0) + $1)::TEXT,
               updated_at = NOW()`,
        [String(newPoolKobo)]
      );

      results.creatorFundSeed = { seededKobo: newPoolKobo, prevMonthRevenueKobo };
    } catch (err) {
      errors.push(`creatorFundSeed: ${String(err)}`);
    }
  }

  if (utcDay === 5) {
    // Day 5 — Distribute the seeded pool to eligible creators and reset to 0
    try {
      const { distributeCreatorFund } = await import('@/lib/creator/fund');
      const { rows: fundRows } = await db.query<{ value: string }>(
        `SELECT value FROM x_manifest WHERE key = 'creator_fund_balance_kobo' LIMIT 1`
      );
      const poolKobo = parseInt(fundRows[0]?.value ?? "0", 10);
      if (poolKobo > 0) {
        const fundResult = await distributeCreatorFund(poolKobo);
        await db.query(
          `INSERT INTO x_manifest (key, value) VALUES ('creator_fund_balance_kobo', '0')
           ON CONFLICT (key) DO UPDATE SET value = '0', updated_at = NOW()`
        );
        results.creatorFundDistribution = { creatorsRewarded: fundResult, poolKobo };
      } else {
        results.creatorFundDistribution = { skipped: true, reason: 'Pool is empty' };
      }
    } catch (err) {
      errors.push(`creatorFundDistribution: ${String(err)}`);
    }
  }

  // 9b. Expired message-pin sweep — unpin coin-purchased pins whose 1-hour window
  //      has passed (PRD §11: Message Pin lasts 1 hour). Legacy moderator pins
  //      have pin_expires_at IS NULL and are left untouched.
  try {
    const { rowCount: unpinnedCount } = await db.query(
      `UPDATE room_messages
       SET is_pinned = false, pinned_at = NULL, pinned_by = NULL, pin_expires_at = NULL
       WHERE is_pinned = true
         AND pin_expires_at IS NOT NULL
         AND pin_expires_at <= NOW()`
    );
    results.expiredPinSweep = { unpinned: unpinnedCount ?? 0 };
  } catch (err) {
    errors.push(`expiredPinSweep: ${String(err)}`);
  }

  // 10. Guild tier demotion — demote guilds below minimum after 7 days
  try {
    // CRON-GUILD-01: uses module-level GUILD_TIERS constant (single source of truth).
    type GuildTierName = (typeof GUILD_TIERS)[number]['name'];

    function getTierConfig(tier: string) {
      return GUILD_TIERS.find((t) => t.name === tier);
    }

    // Demotion goes down one full tier group (e.g. any gold → silver_3).
    // Bronze has no demotion.
    function getDemotedTier(tier: string): GuildTierName | null {
      const group = tier.split('_')[0] as string;
      const groupOrder = ['bronze', 'silver', 'gold', 'platinum', 'legend'];
      const groupIdx = groupOrder.indexOf(group);
      if (groupIdx <= 0) return null; // bronze has no demotion; unknown tier → null
      const prevGroup = groupOrder[groupIdx - 1];
      // Highest sub-tier of the previous group
      const prevTiers = GUILD_TIERS.filter((t) => t.name.startsWith(prevGroup + '_'));
      return (prevTiers[prevTiers.length - 1]?.name as GuildTierName) ?? null;
    }

    function tierMinMembers(tier: string): number {
      return getTierConfig(tier)?.minMembers ?? 0;
    }

    function demotedTier(tier: string): string | null {
      return getDemotedTier(tier);
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
            `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
             VALUES ($1, 'guild_tier_demoted', $2, $3, $4, false, NOW())`,
            [
              guild.captain_id,
              "Guild Tier Update",
              `Your guild has moved from ${guild.tier} to ${newTier} tier.`,
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

  // Guild tier promotion
  // CRON-GUILD-01: uses module-level GUILD_TIERS constant (single source of truth).
  // Kept in a separate try block so promotion failures don't affect demotion results.
  try {
    const { rows: promotionCandidates } = await db.query<{
      id: string; captain_id: string; tier: string; guild_xp: number; member_count: number;
    }>(
      `SELECT g.id, g.captain_id, g.tier, g.guild_xp,
              COUNT(gm.user_id)::int AS member_count
       FROM guilds g
       LEFT JOIN guild_members gm ON gm.guild_id = g.id AND gm.left_at IS NULL
       WHERE g.tier != 'legend' AND g.deleted_at IS NULL
       GROUP BY g.id, g.captain_id, g.tier, g.guild_xp`
    );

    const promoMap = new Map(GUILD_TIERS.map((t) => [t.name, t]));

    let promoted = 0;
    for (const guild of promotionCandidates) {
      const threshold = promoMap.get(guild.tier);
      if (!threshold || !threshold.next) continue;
      if (guild.guild_xp >= threshold.promotionXP && guild.member_count >= threshold.minMembers) {
        const fromTier = guild.tier;
        const toTier = threshold.next;
        await db.query(
          `UPDATE guilds SET tier = $2, updated_at = NOW() WHERE id = $1`,
          [guild.id, toTier]
        );
        await db.query(
          `INSERT INTO guild_tier_history (guild_id, from_tier, to_tier, guild_xp_at, changed_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [guild.id, fromTier, toTier, guild.guild_xp]
        ).catch(() => {});
        await db.query(
          `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
           VALUES ($1, 'guild_tier_promoted', $2, $3, $4, false, NOW())`,
          [
            guild.captain_id,
            "Guild Promoted!",
            `Your guild has been promoted from ${fromTier} to ${toTier} tier.`,
            JSON.stringify({ guildId: guild.id, fromTier, toTier, guildXp: guild.guild_xp }),
          ]
        ).catch(() => {});
        promoted++;
      }
    }

    results.guildTierPromotions = promoted;
  } catch (err) {
    errors.push(`guildTierPromotion: ${String(err)}`);
  }

  // 11. "The Patron" badge — award to users who are top gifter in 3+ rooms in last 24h
  try {
    // Find users who are the top gifter (by coin_cost) in 3+ rooms in the last 24 hours
    const { rows: patronCandidates } = await db.query<{ user_id: string; room_count: string }>(
      `WITH room_totals AS (
         SELECT room_id, sender_id, SUM(coin_cost) AS total_coins
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
        `INSERT INTO user_badges (user_id, badge_type, badge_key, awarded_at, metadata)
         VALUES ($1, 'patron', 'patron', NOW(), $2)
         ON CONFLICT (user_id, badge_key) DO UPDATE SET awarded_at = NOW(), metadata = $2`,
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

  // 12. Leaderboard ripple notifications — notify users of passive rank changes
  try {
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

    if (currentRanks.length > 0) {
      const userIds = currentRanks.map((r) => r.user_id);

      // Batch-fetch all previous snapshots in one query instead of one query per user
      const { rows: prevSnapshots } = await db.query<{ user_id: string; rank: number; xp: number }>(
        `SELECT user_id, rank, xp FROM leaderboard_rank_snapshots
         WHERE scope = 'global' AND user_id = ANY($1::uuid[])`,
        [userIds]
      );
      const prevByUser = new Map(prevSnapshots.map((p) => [p.user_id, p]));

      const notifUserIds: string[] = [];
      const notifDirections: string[] = [];
      const notifFromRanks: number[] = [];
      const notifToRanks: number[] = [];
      const snapUserIds: string[] = [];
      const snapRanks: number[] = [];
      const snapXps: number[] = [];

      for (const current of currentRanks) {
        const currentRank = parseInt(current.rank);
        const currentXp = parseInt(current.xp_value);
        const prev = prevByUser.get(current.user_id);
        const prevRank = prev?.rank ?? null;

        if (prevRank !== null && prevRank !== currentRank && Math.abs(prevRank - currentRank) >= 5) {
          const direction = currentRank < prevRank ? 'up' : 'down';
          notifUserIds.push(current.user_id);
          notifDirections.push(direction);
          notifFromRanks.push(prevRank);
          notifToRanks.push(currentRank);
        }

        snapUserIds.push(current.user_id);
        snapRanks.push(currentRank);
        snapXps.push(currentXp);
      }

      // Batch upsert all snapshots in a single query using unnest()
      if (snapUserIds.length > 0) {
        await db.query(
          `INSERT INTO leaderboard_rank_snapshots (user_id, scope, rank, xp, snapped_at)
           SELECT unnest($1::uuid[]), 'global', unnest($2::int[]), unnest($3::int[]), NOW()
           ON CONFLICT (user_id, scope)
           DO UPDATE SET rank = EXCLUDED.rank, xp = EXCLUDED.xp, snapped_at = NOW()`,
          [snapUserIds, snapRanks, snapXps]
        ).catch(() => {});
      }

      // Batch insert all notifications in a single query using unnest()
      if (notifUserIds.length > 0) {
        await db.query(
          `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
           SELECT
             sub.user_id,
             'rank_change',
             CASE WHEN sub.direction = 'up' THEN 'Your rank improved!' ELSE 'Your rank dropped' END,
             'Your position on the global leaderboard changed.',
             jsonb_build_object('direction', sub.direction, 'fromRank', sub.from_rank, 'toRank', sub.to_rank),
             false,
             NOW()
           FROM (
             SELECT
               unnest($1::uuid[]) AS user_id,
               unnest($2::text[]) AS direction,
               unnest($3::int[]) AS from_rank,
               unnest($4::int[]) AS to_rank
           ) sub`,
          [notifUserIds, notifDirections, notifFromRanks, notifToRanks]
        ).catch(() => {});
        notified = notifUserIds.length;
      }
    }

    results.leaderboardRipple = { notified, snapshotCount: currentRanks.length };
  } catch (err) {
    errors.push(`leaderboardRipple: ${String(err)}`);
  }

  // 13. Platform Council invitation (last 7 days of month)
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
           AND u.deleted_at IS NULL
           AND COALESCE(u.is_banned, false) = false
           AND u.login_streak_days > 0
           AND u.prestige_count >= 5
         ORDER BY u.legacy_score DESC
         LIMIT 50`
      );

      const { sendPushNotification } = await import('@/lib/notifications/push');
      const councilCycleMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      let invited = 0;
      for (const candidate of candidates) {
        // reference_id = "council_invite:<cycle_month>" so ON CONFLICT deduplicates
        // re-runs of this CRON step within the same month (BUG-NOTIF-01).
        const councilRefId = `council_invite:${councilCycleMonth}`;
        await db.query(
          `INSERT INTO notifications (user_id, type, title, body, metadata, reference_id, created_at)
           VALUES ($1, 'council_invitation', 'Platform Council Invitation',
             'You are among the top contributors on Zobia. You have been invited to join the Platform Council.',
             $2, $3, NOW())
           ON CONFLICT (user_id, type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
          [candidate.id, JSON.stringify({ legacyScore: candidate.legacy_score }), councilRefId]
        );
        // Send push notification to eligible users (fire-and-forget)
        sendPushNotification(
          candidate.id,
          '🏛️ Platform Council Invitation',
          'You are among the top contributors on Zobia. You have been invited to join the Platform Council.',
          { action: 'open_council' }
        ).catch(() => {});
        invited++;
      }
      results.councilInvitations = { invited };
    }
  } catch (err) {
    errors.push(`councilInvitations: ${String(err)}`);
  }

  // 14. Re-engagement notification dispatch
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
       WHERE uie.push_email_notified = false
         AND uie.created_at >= NOW() - INTERVAL '25 hours'
       ORDER BY uie.user_id, uie.inactive_days DESC`
    );

    const { getReengagementPayload } = await import('@/lib/notifications/reengagement');
    const { sendPushNotification } = await import('@/lib/notifications/push');
    const { sendEmail } = await import('@/lib/notifications/email');

    // 11a. Credit 200 comeback coins for users who just hit 90-day inactivity threshold
    //      Coins are "reserved" — if the user doesn't log in within 7 days they will be
    //      reversed by the expiry task below.
    for (const user of inactiveUsers) {
      if (user.days_inactive === 90) {
        try {
          // ZB-05: use creditCoins so balance_before/after are tracked correctly
          const { creditCoins } = await import("@/lib/economy/coins");
          await db.transaction(async (tx) => {
            const comebackMonthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
            await creditCoins(
              user.user_id,
              COMEBACK_COIN_AMOUNT,
              "comeback_bonus_reserved",
              `comeback:${user.user_id}:${comebackMonthKey}`,
              "Comeback bonus — expires in 7 days if unused",
              {},
              tx
            );
          });
        } catch {
          // Non-fatal — coin reservation failure must not block notifications
        }
      }
    }

    // Pre-fetch personalised context for each inactive user in parallel
    const personalContextMap = new Map<string, { guildEvent?: string; seasonPhase?: string; nemesisContext?: string }>();
    await Promise.all(inactiveUsers.map(async (user) => {
      const ctx: { guildEvent?: string; seasonPhase?: string; nemesisContext?: string } = {};
      try {
        if (user.days_inactive >= 7 && user.days_inactive < 14) {
          // Guild war outcome for ~7-day inactive users
          // ZB-15: guild_wars has no result/guild_id/ended_at — derive from winner_guild_id / ends_at
          const { rows: gwRows } = await db.query<{ is_win: boolean; guild_name: string }>(
            `SELECT
               gw.winner_guild_id = gm.guild_id AS is_win,
               g.name AS guild_name
             FROM guild_wars gw
             JOIN guild_members gm
               ON gm.guild_id IN (gw.challenger_guild_id, gw.defender_guild_id)
               AND gm.user_id = $1
             JOIN guilds g ON g.id = gm.guild_id
             WHERE gw.status = 'completed'
               AND gw.ends_at >= NOW() - INTERVAL '30 days'
             ORDER BY gw.ends_at DESC
             LIMIT 1`,
            [user.user_id]
          );
          if (gwRows[0]) {
            const { is_win, guild_name } = gwRows[0];
            ctx.guildEvent = is_win
              ? `Your guild "${guild_name}" won a war while you were away!`
              : `Your guild "${guild_name}" fought hard in your absence — come back and help them win the next one.`;
          }
          // Nemesis XP delta
          const { rows: nemesisRows } = await db.query<{ nemesis_user_id: string; xp_delta: number }>(
            `SELECT na.nemesis_user_id, (nu.xp_total - u.xp_total) AS xp_delta
             FROM nemesis_assignments na
             JOIN users u  ON u.id  = na.user_id
             JOIN users nu ON nu.id = na.nemesis_user_id
             WHERE na.user_id = $1
             LIMIT 1`,
            [user.user_id]
          );
          if (nemesisRows[0] && nemesisRows[0].xp_delta > 0) {
            ctx.nemesisContext = `Your nemesis gained ${nemesisRows[0].xp_delta.toLocaleString()} XP while you were away. Time to catch up!`;
          }
        } else if (user.days_inactive >= 14) {
          // Current season phase for ~14-day inactive users
          // ZB-16: seasons has no phase column — compute it from timestamps
          const { rows: seasonRows } = await db.query<{ name: string; starts_at: string; ends_at: string }>(
            `SELECT name, starts_at, ends_at FROM seasons WHERE is_active = TRUE LIMIT 1`
          );
          if (seasonRows[0]) {
            const { name: seasonName, starts_at, ends_at } = seasonRows[0];
            const start = new Date(starts_at).getTime();
            const end = new Date(ends_at).getTime();
            const ratio = (Date.now() - start) / (end - start);
            const phase =
              ratio >= 0.95 || end - Date.now() <= 86_400_000 ? 'final day' :
              ratio >= 0.75 ? 'push' :
              ratio >= 0.25 ? 'mid' : 'opening';
            ctx.seasonPhase = `Season "${seasonName}" is in the ${phase} phase — jump back in before it ends!`;
          }
        }
      } catch {
        // Non-fatal — context enrichment failure must not block notifications
      }
      personalContextMap.set(user.user_id, ctx);
    }));

    let dispatched = 0;
    for (const user of inactiveUsers) {
      const payload = getReengagementPayload(
        user.user_id,
        user.days_inactive,
        user.last_streak_before_break,
        personalContextMap.get(user.user_id)
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
            `<p>${payload.body}</p>`,
            'reengagement',
            user.user_id
          ).catch(() => {});
        } catch {
          // Non-fatal — email errors must not block other CRON tasks
        }
      }

      // Mark push/email as notified
      await db.query(
        `UPDATE user_inactivity_events
         SET push_email_notified = true
         WHERE user_id = $1 AND inactive_days = $2 AND push_email_notified = false`,
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
  //     Algorithm: check cron_state.next_mystery_drop_at; fire if now >= that time,
  //     then schedule the next drop at now + random 3–7 days for true unpredictability.
  try {
    const { rows: dropFlagRows } = await db.query<{ value: string }>(
      `SELECT value FROM x_manifest WHERE key = 'feature_mystery_xp_drops' LIMIT 1`
    );
    const dropEnabled = (dropFlagRows[0]?.value ?? 'true') === 'true';

    if (dropEnabled) {
      const { rows: batchRows } = await db.query<{ value: string }>(
        `SELECT value FROM x_manifest WHERE key = 'mystery_drop_batch_size' LIMIT 1`
      );
      const batchSize = parseInt(batchRows[0]?.value ?? '50', 10);

      // Check scheduled drop time from cron_state
      const { rows: stateRows } = await db.query<{ value_ts: string }>(
        `SELECT value_ts FROM cron_state WHERE key = 'next_mystery_drop_at' LIMIT 1`
      );
      const nextDropAt = stateRows[0]?.value_ts ? new Date(stateRows[0].value_ts) : null;
      const shouldFireToday = nextDropAt !== null && new Date() >= nextDropAt;

      if (shouldFireToday) {
        const { triggerMysteryXPDrop } = await import('@/lib/mystery/xpDrop');
        const dropResult = await triggerMysteryXPDrop(db, batchSize);

        // Schedule next drop: random 3–7 days from now
        const daysUntilNext = 3 + Math.random() * 4; // [3, 7)
        await db.query(
          `INSERT INTO cron_state (key, value_ts, updated_at)
           VALUES ('next_mystery_drop_at', NOW() + ($1 || ' days')::INTERVAL, NOW())
           ON CONFLICT (key) DO UPDATE SET value_ts = NOW() + ($1 || ' days')::INTERVAL, updated_at = NOW()`,
          [daysUntilNext.toFixed(4)]
        );

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
        results.mysteryXpDrop = { fired: false, reason: 'Not a drop day', nextDropAt: nextDropAt?.toISOString() ?? null };
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
          `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
           VALUES ($1, 'guild_low_contribution', $2, $3, $4, false, NOW())`,
          [
            member.user_id,
            "Guild Contribution Alert",
            `Your contribution score is below the guild average for ${weeksBelowCount} week${weeksBelowCount !== 1 ? 's' : ''}.`,
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
       FROM conversation_scores
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

        // Grant the sticker pack to both users — look up pack_id by name first
        const packName = `dm_streak_${milestone}`;
        const { rows: packRows } = await db.query<{ id: string }>(
          `SELECT id FROM sticker_packs WHERE name = $1 LIMIT 1`,
          [packName]
        ).catch(() => ({ rows: [] as Array<{ id: string }> }));
        if (packRows[0]) {
          await db.query(
            `INSERT INTO user_sticker_packs (user_id, pack_id)
             VALUES ($1, $2), ($3, $2)
             ON CONFLICT (user_id, pack_id) DO NOTHING`,
            [convo.user_id_1, packRows[0].id, convo.user_id_2]
          ).catch(() => {});
        }

        // Notify both participants
        for (const uid of [convo.user_id_1, convo.user_id_2]) {
          await db.query(
            `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
             VALUES ($1, 'dm_sticker_unlock', $2, $3, $4, false, NOW())`,
            [
              uid,
              "Sticker Pack Unlocked!",
              `Your ${milestone}-day conversation streak unlocked exclusive sticker reactions!`,
              JSON.stringify({
                milestone,
                otherUserId: uid === convo.user_id_1 ? convo.user_id_2 : convo.user_id_1,
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
       WHERE uie.telegram_notified = false
         AND uie.created_at >= NOW() - INTERVAL '25 hours'
         AND u.telegram_id IS NOT NULL
         AND u.deleted_at IS NULL
       ORDER BY uie.user_id, uie.inactive_days DESC`
    );

    const { getReengagementPayload } = await import('@/lib/notifications/reengagement');
    const { sendTelegramMessage } = await import('@/lib/notifications/telegram');

    let telegramSent = 0;
    const successfullyNotifiedIds: string[] = [];
    for (const user of telegramUsers) {
      const payload = getReengagementPayload(
        user.user_id,
        user.days_inactive,
        user.last_streak_before_break
      );
      if (!payload) continue;

      try {
        await sendTelegramMessage(
          user.telegram_id,
          `<b>${payload.title}</b>\n\n${payload.body}`
        );
        successfullyNotifiedIds.push(user.user_id);
        telegramSent++;
      } catch (err) {
        console.error('[cron/daily] Telegram delivery failed for user', user.user_id, err);
      }
    }

    // Only mark as notified users whose Telegram message was actually delivered
    if (successfullyNotifiedIds.length > 0) {
      await db.query(
        `UPDATE user_inactivity_events
         SET telegram_notified = true
         WHERE user_id = ANY($1::uuid[]) AND telegram_notified = false`,
        [successfullyNotifiedIds]
      ).catch((err: unknown) => console.error('[cron/daily] Failed to mark telegram users notified:', err));
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
               AND p.status = 'completed'
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
  //
  // BUG-21: The dedup key is now `plan:{userId}:{YYYY-MM}` (same pattern used
  // by processSubscriptionEvent in the Paystack webhook) so subscribing on the 1st
  // cannot yield both a subscription_bonus AND a monthly_plan_bonus credit.
  //
  // BUG-60: All three plan tiers are processed inside a single DB transaction so
  // a partial failure cannot leave distribution half-applied.
  try {
    const today = new Date();
    if (today.getDate() === 1) {
      const PLAN_MONTHLY_BONUS: Record<string, number> = { plus: 50, pro: 200, max: 500 };
      // YYYY-MM string used as part of the dedup reference_id
      const monthKey = today.toISOString().slice(0, 7); // e.g. "2026-06"
      const planBonusErrors: string[] = [];

      // BUG-60: wrap all three plan tiers in one transaction so partial failures
      // are atomic — either all plans are credited or none are.
      try {
        await db.transaction(async (tx) => {
          for (const [plan, bonus] of Object.entries(PLAN_MONTHLY_BONUS)) {
            // Credit ledger and balance atomically for each plan tier.
            // Dedup key: `plan:{userId}:{YYYY-MM}` — matches the webhook pattern
            // to prevent double-crediting when a subscription event and CRON both fire
            // on the 1st (BUG-21).
            // ZB-05: include balance_before/balance_after (NOT NULL in coin_ledger).
            await tx.query(
              `WITH eligible AS (
                 SELECT id, coin_balance FROM users
                 WHERE plan = $1
                   AND deleted_at IS NULL
                   AND COALESCE(is_banned, false) = false
                   AND NOT EXISTS (
                     SELECT 1 FROM coin_ledger
                     WHERE user_id = users.id
                       AND transaction_type = 'subscription_bonus'
                       AND reference_id LIKE 'plan:' || users.id::text || ':' || $4
                   )
               ),
               ledger_rows AS (
                 INSERT INTO coin_ledger
                   (user_id, amount, balance_before, balance_after, transaction_type, reference_id, description, created_at)
                 SELECT id, $2, coin_balance, coin_balance + $2,
                        'subscription_bonus',
                        'plan:' || id::text || ':' || $4,
                        $3, NOW()
                 FROM eligible
                 ON CONFLICT (transaction_type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
                 RETURNING user_id
               )
               UPDATE users
               SET coin_balance = coin_balance + $2,
                   updated_at = NOW()
               WHERE id IN (SELECT user_id FROM ledger_rows)`,
              [plan, bonus, `Monthly ${plan} plan bonus`, monthKey]
            );
          }
        });
      } catch (txErr: unknown) {
        // BUG-21: swallow unique constraint violations (23505) — they mean the
        // bonus was already awarded by the webhook on this month, which is correct.
        const pgCode = (txErr as { code?: string })?.code;
        if (pgCode === '23505') {
          console.info('[cron/21] monthly_plan_bonus already awarded this month (23505) — skipping');
        } else {
          planBonusErrors.push(String(txErr));
          errors.push(`monthlyPlanBonus: ${String(txErr)}`);
        }
      }

      results.monthlyPlanBonus = {
        ran: true,
        plansProcessed: Object.keys(PLAN_MONTHLY_BONUS).length,
        date: today.toISOString(),
        errors: planBonusErrors.length > 0 ? planBonusErrors : undefined,
      };
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
       WHERE cl.transaction_type = 'comeback_bonus_reserved'
         AND cl.created_at < NOW() - INTERVAL '7 days'
         AND NOT EXISTS (
           SELECT 1 FROM coin_ledger cl2
           WHERE cl2.user_id = cl.user_id
             AND cl2.transaction_type = 'comeback_bonus_claimed'
             AND cl2.created_at > cl.created_at
         )
         AND (u.last_active_at IS NULL OR u.last_active_at < cl.created_at)
         AND u.deleted_at IS NULL`
    );

    let expiredBonuses = 0;
    const { debitCoins } = await import("@/lib/economy/coins");
    for (const row of expiredBonusUsers) {
      try {
        // BUG-45: Use debitCoins() so balance_before/after are tracked correctly
        // and the reversal goes through the authoritative coin ledger path.
        await db.transaction(async (tx) => {
          await debitCoins(
            row.user_id,
            COMEBACK_COIN_AMOUNT,
            "comeback_bonus_expired",
            `comeback_reversal:${row.user_id}`,
            "Comeback bonus expired (7-day window passed)",
            {},
            tx
          );
        });
        expiredBonuses++;
      } catch (coinErr) {
        // CRON-COIN-01: INSUFFICIENT_BALANCE means the user already spent the bonus
        // coins — this is expected and not an error (the reversal is a no-op).
        if ((coinErr as NodeJS.ErrnoException)?.code !== 'INSUFFICIENT_BALANCE') {
          console.error('[cron/22] Unexpected error expiring comeback bonus for user', row.user_id, coinErr);
        }
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
        // Expire last week's incomplete quests (mark is_completed = false is already the state;
        // set is_active = false to exclude them from display)
        await db.query(
          `UPDATE guild_quests
           SET is_active = false
           WHERE guild_id = $1
             AND week_end < $2
             AND is_completed = false`,
          [guild.id, weekStart]
        ).catch(() => {});

        // Create the new week's quests for this guild (skip if already created)
        for (const template of GUILD_QUEST_TEMPLATES) {
          await db.query(
            `INSERT INTO guild_quests
               (guild_id, title, description, quest_type, target_count,
                current_count, reward_guild_xp, reward_coins,
                week_start, week_end, is_completed, is_active, created_at)
             VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, false, true, NOW())
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
          `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
           SELECT gm.user_id,
                  'guild_quests_reset',
                  'New Weekly Quests',
                  'Your guild''s weekly quests have been reset. Complete them to earn rewards!',
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
  try {
    const { advanceFlashXPLifecycle } = await import('@/lib/events/flashXP');
    results.flashXpLifecycle = await advanceFlashXPLifecycle();
  } catch (err) {
    errors.push(`flashXpLifecycle: ${String(err)}`);
  }

  // 25. Enforce plan-based message history limits (PRD §3)
  // Free  = 90 days  |  Plus = 180 days  |  Pro/Max = Unlimited
  // We hard-delete messages (DMs and group messages) sent by users whose plan
  // puts a cap on how far back history is retained.  The cutoff is applied to
  // the SENDER's current plan at the time the CRON runs.
  try {
    // DM messages: delete from the messages table rows older than plan limit
    // Uses the plan at message creation time, not sender's current plan
    const freeDeleted = await db.query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM messages m
         WHERE m.sender_plan_at_creation = 'free'
           AND m.created_at < NOW() - INTERVAL '90 days'
         RETURNING 1
       )
       SELECT COUNT(*)::text AS count FROM deleted`
    );

    const plusDeleted = await db.query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM messages m
         WHERE m.sender_plan_at_creation = 'plus'
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

  // 26. Ad revenue share auto-enrolment for Free Open Rooms with 500+ MAU (PRD §10)
  //     On the 1st of each month: snapshot MAU for all active free_open rooms,
  //     then auto-enrol any room whose last-month MAU count reaches 500+.
  try {
    const today = new Date();
    if (today.getUTCDate() === 1) {
      // Last month's window
      const lastMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const lastMonthEnd   = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(),     1));
      const monthKey       = lastMonthStart.toISOString().slice(0, 10);

      // Count distinct active members (message senders) per free_open room last month
      const { rows: mauRows } = await db.query<{ room_id: string; mau_count: string }>(
        `SELECT rm.room_id, COUNT(DISTINCT rm.user_id)::TEXT AS mau_count
         FROM room_members rm
         JOIN rooms r ON r.id = rm.room_id
         WHERE r.type = 'free_open'
           AND r.is_active = TRUE
           AND rm.joined_at < $2
           AND (rm.left_at IS NULL OR rm.left_at >= $1)
         GROUP BY rm.room_id`,
        [lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
      ).catch(() => ({ rows: [] as Array<{ room_id: string; mau_count: string }> }));

      let snapshotted = 0;
      let enrolled = 0;

      for (const row of mauRows) {
        const mau = parseInt(row.mau_count, 10);

        // Upsert MAU snapshot
        await db.query(
          `INSERT INTO room_monthly_active_users (room_id, month, mau_count)
           VALUES ($1, $2::date, $3)
           ON CONFLICT (room_id, month) DO UPDATE SET mau_count = $3`,
          [row.room_id, monthKey, mau]
        ).catch(() => {});
        snapshotted++;

        // Auto-enrol in ad revenue share if MAU >= 500
        if (mau >= 500) {
          const { rowCount } = await db.query(
            `UPDATE rooms SET is_ad_enrolled = TRUE, updated_at = NOW()
             WHERE id = $1 AND is_ad_enrolled = FALSE`,
            [row.room_id]
          ).catch(() => ({ rowCount: 0 }));
          if ((rowCount ?? 0) > 0) {
            // Notify the creator
            await db.query(
              `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
               SELECT creator_id, 'ad_revenue_enrolled',
                      'Ad Revenue Enabled',
                      'Your room has been enrolled in ad revenue sharing based on monthly active users.',
                      jsonb_build_object('roomId', $1::text, 'mauCount', $2),
                      false, NOW()
               FROM rooms WHERE id = $1`,
              [row.room_id, mau]
            ).catch(() => {});
            enrolled++;
          }
        }
      }

      results.adRevenueEnrolment = { snapshotted, enrolled, month: monthKey };
    } else {
      results.adRevenueEnrolment = { ran: false, reason: 'Not the 1st of the month' };
    }
  } catch (err) {
    errors.push(`adRevenueEnrolment: ${String(err)}`);
  }

  // 27. Annual cultural event recurrence (PRD §25)
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

  // 28. Earnable sticker pack auto-unlock (PRD §5)
  //     Earnable packs have an unlock_condition referencing a track level milestone
  //     (e.g. "social_level_10"). Daily CRON checks all users whose track XP has
  //     crossed a milestone and auto-grants the matching earnable pack.
  try {
    // Fetch all earnable packs with conditions
    const { rows: earnablePacks } = await db.query<{
      id: string; name: string; unlock_condition: string;
    }>(
      `SELECT id, name, unlock_condition
       FROM sticker_packs
       WHERE pack_type = 'earnable' AND is_active = TRUE AND unlock_condition IS NOT NULL`
    );

    let earnableUnlocks = 0;

    for (const pack of earnablePacks) {
      // unlock_condition format: "<track>_level_<N>" e.g. "social_level_10"
      const match = pack.unlock_condition.match(/^([a-z_]+)_level_(\d+)$/);
      if (!match) continue;

      const track = match[1];  // e.g. "social"
      const level = parseInt(match[2], 10);

      // Find users who have reached this track level but don't have this pack.
      // Track XP and levels are stored directly on the users table (xp_social, level_social, etc.)
      const trackLevelColumn: Record<string, string> = {
        social:      "level_social",
        creator:     "level_creator",
        competitor:  "level_competitor",
        generosity:  "level_generosity",
        knowledge:   "level_knowledge",
        explorer:    "level_explorer",
      };
      const levelCol = trackLevelColumn[track];
      if (!levelCol) continue;
      const { rows: eligible } = await db.query<{ user_id: string }>(
        `SELECT u.id AS user_id
         FROM users u
         WHERE u.${levelCol} >= $1
           AND u.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM user_sticker_packs usp
             WHERE usp.user_id = u.id AND usp.pack_id = $2
           )`,
        [level, pack.id]
      );

      for (const row of eligible) {
        await db.query(
          `INSERT INTO user_sticker_packs (user_id, pack_id, unlocked_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT DO NOTHING`,
          [row.user_id, pack.id]
        ).catch(() => {});

        // Notify user
        await db.query(
          `INSERT INTO notifications (user_id, type, title, body, metadata, created_at)
           VALUES ($1, 'sticker_pack_unlocked', 'New Sticker Pack!', $2, $3, NOW())`,
          [
            row.user_id,
            `You unlocked the "${pack.name}" sticker pack through your progression!`,
            JSON.stringify({ packId: pack.id, track, level }),
          ]
        ).catch(() => {});

        earnableUnlocks++;
      }
    }

    results.earnableStickerUnlocks = { unlocked: earnableUnlocks };
  } catch (err) {
    errors.push(`earnableStickerUnlocks: ${String(err)}`);
  }

  // 29. Creator tier progression — update based on room member counts (PRD §10)
  //     Rookie: 0–99  |  Rising: 100–499  |  Verified: 500–1999  |  Elite/Icon: 2000+
  try {
    const { rows: creatorRooms } = await db.query<{
      creator_id: string;
      total_members: string;
    }>(
      `SELECT r.creator_id, SUM(rm.member_count)::TEXT AS total_members
       FROM rooms r
       JOIN LATERAL (
         SELECT COUNT(*) AS member_count
         FROM room_members rmp
         WHERE rmp.room_id = r.id AND rmp.left_at IS NULL
       ) rm ON TRUE
       WHERE r.deleted_at IS NULL AND r.is_active = TRUE
       GROUP BY r.creator_id`
    );

    const tierForCount = (count: number): string => {
      if (count >= 5000) return "icon";
      if (count >= 2000) return "elite";
      if (count >= 500)  return "verified";
      if (count >= 100)  return "rising";
      return "rookie";
    };

    let tierUpdates = 0;
    for (const row of creatorRooms) {
      const memberCount = parseInt(row.total_members, 10);
      const newTier = tierForCount(memberCount);
      const { rowCount: tierRowCount } = await db.query(
        `UPDATE users
         SET creator_tier = $1, updated_at = NOW()
         WHERE id = $2 AND is_creator = TRUE
           AND COALESCE(creator_tier, 'rookie') != $1
         RETURNING id`,
        [newTier, row.creator_id]
      ).catch(() => ({ rowCount: 0 }));
      // CRON-TIER-01: only count updates where the tier actually changed
      if ((tierRowCount ?? 0) > 0) tierUpdates++;
    }
    results.creatorTierUpdates = { updated: tierUpdates };
  } catch (err) {
    errors.push(`creatorTierUpdates: ${String(err)}`);
  }

  // 30. Moderation daily digest (Fridays) — email admin moderation summary
  try {
    const dayOfWeekForDigest = new Date().getUTCDay();
    if (dayOfWeekForDigest === 5) {
      // CRON-DIGEST-01: report totals span the full backlog (no date filter);
      // new_reports_7d counts only reports submitted this week.
      const { rows: digestRows } = await db.query<{
        open_reports: string; escalated: string; actions_taken: string; new_reports_7d: string;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM reports WHERE status = 'open') AS open_reports,
           (SELECT COUNT(*) FROM reports WHERE status = 'escalated') AS escalated,
           (SELECT COUNT(*) FROM moderation_actions WHERE created_at >= NOW() - INTERVAL '7 days') AS actions_taken,
           (SELECT COUNT(*) FROM reports WHERE created_at >= NOW() - INTERVAL '7 days') AS new_reports_7d`
      );

      const { rows: adminRows } = await db.query<{ email: string }>(
        `SELECT u.email FROM users u
         JOIN admin_roles ar ON ar.user_id = u.id
         WHERE u.email IS NOT NULL AND ar.role = 'admin'
         LIMIT 20`
      );

      if (adminRows.length > 0) {
        const { sendEmail } = await import('@/lib/notifications/email');
        const digest = digestRows[0];
        const body = `Weekly moderation digest:\n- Open reports (total): ${digest?.open_reports ?? 0}\n- Escalated (total): ${digest?.escalated ?? 0}\n- New reports this week: ${digest?.new_reports_7d ?? 0}\n- Actions taken this week: ${digest?.actions_taken ?? 0}`;
        for (const admin of adminRows) {
          sendEmail(
            admin.email,
            "Zobia Weekly Moderation Digest",
            body,
            `<p>${body.replace(/\n/g, "<br>")}</p>`
          ).catch(() => {});
        }
      }
      results.moderationDigest = { sent: adminRows.length };
    }
  } catch (err) {
    errors.push(`moderationDigest: ${String(err)}`);
  }

  // 31. Master Teacher award (end of season) — top Elder by mentees mentored
  try {
    const { rows: endedSeasonElderRows } = await db.query<{ id: string }>(
      `SELECT id FROM seasons WHERE is_active = FALSE AND ends_at >= NOW() - INTERVAL '7 days' LIMIT 1`
    );
    if (endedSeasonElderRows[0]) {
      const seasonId = endedSeasonElderRows[0].id;
      // Find elder with most completed mentorships this season
      const { rows: topElders } = await db.query<{ elder_id: string; mentee_count: string }>(
        `SELECT elder_id, COUNT(*)::TEXT AS mentee_count
         FROM elder_mentorships
         WHERE ended_at IS NOT NULL
           AND ended_at >= (SELECT starts_at FROM seasons WHERE id = $1)
           AND ended_at <= (SELECT ends_at FROM seasons WHERE id = $1)
         GROUP BY elder_id
         ORDER BY mentee_count DESC
         LIMIT 1`,
        [seasonId]
      );
      if (topElders[0]) {
        const elderId = topElders[0].elder_id;
        await db.query(
          `INSERT INTO user_badges (user_id, badge_type, badge_key, awarded_at, metadata)
           VALUES ($1, 'master_teacher', 'master_teacher', NOW(), $2)
           ON CONFLICT (user_id, badge_key) DO UPDATE SET awarded_at = NOW(), metadata = $2`,
          [elderId, JSON.stringify({ seasonId, menteeCount: parseInt(topElders[0].mentee_count) })]
        ).catch(() => {});
        await db.query(
          `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
           VALUES ($1, 'master_teacher_award', 'Master Teacher Award', 'You have been awarded the Master Teacher badge for this season!', $2, false, NOW())`,
          [elderId, JSON.stringify({ seasonId, menteeCount: parseInt(topElders[0].mentee_count) })]
        ).catch(() => {});
        results.masterTeacherAward = { elderId, seasonId };
      }
    }
  } catch (err) {
    errors.push(`masterTeacherAward: ${String(err)}`);
  }

  // 32. Nemesis overtake/triumph notifications (daily after nemesis refresh on Sundays)
  try {
    const dayForNemesis = new Date().getUTCDay();
    if (dayForNemesis === 0) {
      // After refresh, check for users whose nemesis has overtaken them in XP
      // CRON-NEMESIS-01: filter by last_notified_at (not created_at) so we notify
      // for all assignments where the nemesis has overtaken, not just new ones.
      // Notify at most once per 6 days to avoid spam.
      const { rows: overtakeRows } = await db.query<{
        user_id: string; nemesis_user_id: string;
        user_xp: number; nemesis_xp: number;
      }>(
        `SELECT na.user_id, na.nemesis_user_id,
                u.xp_total AS user_xp, n.xp_total AS nemesis_xp
         FROM nemesis_assignments na
         JOIN users u ON u.id = na.user_id
         JOIN users n ON n.id = na.nemesis_user_id
         WHERE n.xp_total > u.xp_total
           AND (na.last_notified_at IS NULL OR na.last_notified_at < NOW() - INTERVAL '6 days')`
      );

      for (const row of overtakeRows) {
        await db.query(
          `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
           VALUES ($1, 'nemesis_overtook_you', 'Your Nemesis pulled ahead!', 'Your rival has overtaken you in XP. Time to catch up!', $2, false, NOW())
           ON CONFLICT DO NOTHING`,
          [
            row.user_id,
            JSON.stringify({
              nemesisId: row.nemesis_user_id,
              userXp: row.user_xp,
              nemesisXp: row.nemesis_xp,
              gap: row.nemesis_xp - row.user_xp,
            }),
          ]
        ).catch(() => {});

        // Notify nemesis of triumph
        await db.query(
          `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
           VALUES ($1, 'nemesis_triumph', 'You overtook your Nemesis!', 'You have surpassed your rival in XP. Keep the lead!', $2, false, NOW())
           ON CONFLICT DO NOTHING`,
          [
            row.nemesis_user_id,
            JSON.stringify({
              targetId: row.user_id,
              gap: row.nemesis_xp - row.user_xp,
            }),
          ]
        ).catch(() => {});
      }

      // Fire push notifications for all nemesis events in one batch (PRD §2.3)
      if (overtakeRows.length > 0) {
        const { sendPushNotificationBatch } = await import('@/lib/notifications/push');
        sendPushNotificationBatch([
          ...overtakeRows.map((row) => ({
            userId: row.user_id,
            title: '📊 Your Nemesis pulled ahead!',
            body: `Your rival is now ${row.nemesis_xp - row.user_xp} XP ahead. Time to grind!`,
            data: { action: '/nemesis', type: 'nemesis_overtook_you' },
          })),
          ...overtakeRows.map((row) => ({
            userId: row.nemesis_user_id,
            title: '🏆 You overtook your Nemesis!',
            body: `You're ${row.nemesis_xp - row.user_xp} XP ahead of your rival. Keep the lead!`,
            data: { action: '/nemesis', type: 'nemesis_triumph' },
          })),
        ]).catch(() => {});
      }

      // Stamp last_notified_at for both sides of each notified assignment so
      // neither party is re-notified until the next overtake event (BUG-NOTIF-04).
      if (overtakeRows.length > 0) {
        const overtakerIds = overtakeRows.map(r => r.user_id);
        const nemesisIds = overtakeRows.map(r => r.nemesis_user_id);
        const allAffectedIds = [...new Set([...overtakerIds, ...nemesisIds])];
        await db.query(
          `UPDATE nemesis_assignments
           SET last_notified_at = NOW()
           WHERE user_id = ANY($1::uuid[]) OR nemesis_user_id = ANY($1::uuid[])`,
          [allAffectedIds]
        ).catch((err) => console.error('[cron/31] Failed to update nemesis last_notified_at:', err));
      }

      results.nemesisNotifications = { overtakes: overtakeRows.length };
    }
  } catch (err) {
    errors.push(`nemesisNotifications: ${String(err)}`);
  }

  // 32b. Alliance National Alliance Wars weekly resolution + initial pairing (Sundays — PRD §13)
  //      Step A: Pair any alliances that have no active war (first-time or post-bye week).
  //      Step B: Resolve wars that have been running for ≥7 days; re-pair same alliances next week.
  try {
    const dayForAlliance = new Date().getUTCDay();
    if (dayForAlliance === 0) {
      const ALLIANCE_WAR_VICTORY_XP = 300;

      // ── Step A: Initial pairing — find alliances without an active war and pair them ──
      const { rows: unpairedAlliances } = await db.query<{ id: string }>(
        `SELECT id FROM guild_alliances
         WHERE is_active = true
           AND id NOT IN (
             SELECT alliance_1_id FROM alliance_wars WHERE status = 'active'
             UNION
             SELECT alliance_2_id FROM alliance_wars WHERE status = 'active'
           )
         ORDER BY RANDOM()`
      );

      // Pair consecutive alliances; if the count is odd the last alliance sits out this week
      for (let i = 0; i + 1 < unpairedAlliances.length; i += 2) {
        await db.query(
          `INSERT INTO alliance_wars (alliance_1_id, alliance_2_id, status, started_at)
           SELECT LEAST($1, $2), GREATEST($1, $2), 'active', NOW()
           WHERE NOT EXISTS (
             SELECT 1 FROM alliance_wars
             WHERE status = 'active'
               AND (
                 (alliance_1_id = $1 AND alliance_2_id = $2) OR
                 (alliance_1_id = $2 AND alliance_2_id = $1) OR
                 alliance_1_id = $1 OR alliance_2_id = $1 OR
                 alliance_1_id = $2 OR alliance_2_id = $2
               )
           )
           ON CONFLICT DO NOTHING`,
          [unpairedAlliances[i].id, unpairedAlliances[i + 1].id]
        ).catch(() => {});
      }

      // Find all active alliance wars
      const { rows: activeWars } = await db.query<{
        id: string;
        alliance_1_id: string;
        alliance_2_id: string;
        started_at: string;
      }>(
        `SELECT id, alliance_1_id, alliance_2_id, started_at
         FROM alliance_wars
         WHERE status = 'active'
           AND started_at <= NOW() - INTERVAL '7 days'`
      );

      let warsResolved = 0;
      for (const war of activeWars) {
        // Sum XP earned this week by all members of each alliance
        const { rows: scores } = await db.query<{
          alliance_id: string; total_xp: string;
        }>(
          `SELECT gam.alliance_id, SUM(xl.amount)::TEXT AS total_xp
           FROM xp_ledger xl
           JOIN guild_members gm ON gm.user_id = xl.user_id
           JOIN guild_alliance_members gam ON gam.guild_id = gm.guild_id
           WHERE gam.alliance_id IN ($1, $2)
             AND xl.created_at >= $3
             AND gm.left_at IS NULL
           GROUP BY gam.alliance_id`,
          [war.alliance_1_id, war.alliance_2_id, war.started_at]
        );

        const score1 = parseInt(scores.find(s => s.alliance_id === war.alliance_1_id)?.total_xp ?? "0");
        const score2 = parseInt(scores.find(s => s.alliance_id === war.alliance_2_id)?.total_xp ?? "0");
        const winnerId = score1 >= score2 ? war.alliance_1_id : war.alliance_2_id;
        const loserId  = score1 >= score2 ? war.alliance_2_id : war.alliance_1_id;

        await db.query(
          `UPDATE alliance_wars
           SET status = 'completed', winner_alliance_id = $1,
               alliance_1_xp = $2, alliance_2_xp = $3, ended_at = NOW()
           WHERE id = $4`,
          [winnerId, score1, score2, war.id]
        ).catch(() => {});

        // Increment wars_won on the winning alliance (PRD §13 — National Alliance Trophy)
        await db.query(
          `UPDATE guild_alliances SET wars_won = wars_won + 1, updated_at = NOW() WHERE id = $1`,
          [winnerId]
        ).catch(() => {});

        // Award victory XP to all members of winning alliance using safeAwardXP for
        // atomicity and idempotency (per-user reference_id prevents double-award on retry).
        const { rows: warWinners } = await db.query<{ user_id: string }>(
          `SELECT DISTINCT gm.user_id
           FROM guild_members gm
           JOIN guild_alliance_members gam ON gam.guild_id = gm.guild_id
           WHERE gam.alliance_id = $1 AND gm.left_at IS NULL`,
          [winnerId]
        );
        const { safeAwardXP } = await import("@/lib/xp/safeAwardXP");
        for (const winner of warWinners) {
          await safeAwardXP(
            winner.user_id,
            ALLIANCE_WAR_VICTORY_XP,
            "competitor",
            "alliance_war_victory",
            `war_${war.id}_participant_${winner.user_id}`
          ).catch(() => {});
        }

        // Notify all members of both alliances about the war result
        await db.query(
          `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
           SELECT DISTINCT gm.user_id,
                  'alliance_war_result',
                  CASE WHEN gam.alliance_id = $2 THEN 'Alliance War Victory!' ELSE 'Alliance War Ended' END,
                  CASE WHEN gam.alliance_id = $2 THEN 'Your alliance won the war this week!' ELSE 'Your alliance was defeated this week. Regroup and fight back!' END,
                  jsonb_build_object('warId', $1::text, 'won', gam.alliance_id = $2,
                                     'winnerAllianceId', $2::text),
                  false, NOW()
           FROM guild_members gm
           JOIN guild_alliance_members gam ON gam.guild_id = gm.guild_id
           WHERE gam.alliance_id IN ($2, $3) AND gm.left_at IS NULL`,
          [war.id, winnerId, loserId]
        ).catch(() => {});

        // Create next week's war — reference the partial unique index explicitly
        // so that concurrent CRON runs cannot create a duplicate active war pair.
        await db.query(
          `INSERT INTO alliance_wars (alliance_1_id, alliance_2_id, status, started_at)
           VALUES ($1, $2, 'active', NOW())
           ON CONFLICT (alliance_1_id, alliance_2_id) WHERE status = 'active' DO NOTHING`,
          [war.alliance_1_id, war.alliance_2_id]
        ).catch(() => {});

        warsResolved++;
      }
      results.allianceWarsResolved = { resolved: warsResolved };
    }
  } catch (err) {
    errors.push(`allianceWarsResolved: ${String(err)}`);
  }

  // 33. Weekly automated payouts (Fridays) — auto-initiate bank payouts (PRD §12)
  try {
    const dayForPayouts = new Date().getUTCDay();
    if (dayForPayouts === 5) {
      const MIN_PAYOUT_KOBO = 100_000; // ₦1,000 minimum (PRD §14)
      // Find creators with net accumulated earnings above minimum, not banned, with payout account.
      // available_earnings_kobo is the net (post-platform-fee) amount stored on users.
      const { rows: payoutCandidates } = await db.query<{
        creator_id: string; balance_kobo: number; recipient_code: string;
      }>(
        `SELECT u.id AS creator_id, u.available_earnings_kobo AS balance_kobo,
                u.payout_recipient_code AS recipient_code
         FROM users u
         WHERE u.is_creator = TRUE
           AND COALESCE(u.is_banned, false) = FALSE
           AND u.deleted_at IS NULL
           AND u.payout_recipient_code IS NOT NULL
           AND u.available_earnings_kobo >= $1
           AND NOT EXISTS (
             SELECT 1 FROM creator_payouts cp
             WHERE cp.creator_id = u.id
               AND cp.status IN ('awaiting_approval', 'processing')
           )`,
        [MIN_PAYOUT_KOBO]
      );

      let payoutsInitiated = 0;
      const { checkPayoutFraud } = await import('@/lib/fraud/payouts');
      for (const candidate of payoutCandidates) {
        try {
          const idempotencyKey = `weekly_${candidate.creator_id}_${new Date().toISOString().slice(0, 10)}`;
          const fraudResult = await checkPayoutFraud(candidate.creator_id, candidate.balance_kobo, db);
          const status = fraudResult.forceManual ? 'awaiting_approval' : 'pending';
          await db.transaction(async (tx) => {
            // Snapshot bank account details at payout time for audit trail
            const { rows: bankRows } = await tx.query<{
              bank_name: string | null;
              account_number: string | null;
              account_name: string | null;
              recipient_code: string | null;
            }>(
              `SELECT bank_name, account_number, account_name, recipient_code
               FROM creator_bank_accounts
               WHERE creator_id = $1 AND is_primary = TRUE AND deleted_at IS NULL
               LIMIT 1`,
              [candidate.creator_id]
            );
            const bankSnapshot = bankRows[0]
              ? {
                  bank_name: bankRows[0].bank_name,
                  account_number: bankRows[0].account_number,
                  account_name: bankRows[0].account_name,
                  recipient_code: bankRows[0].recipient_code,
                }
              : null;

            // available_earnings_kobo is already net of platform fees (deducted
            // per-transaction when the creator earned). No secondary fee here (BUG-FIN-01).
            const grossKobo = candidate.balance_kobo;
            const platformFeeKobo = 0;
            const netKobo = grossKobo;

            // CRON-PAYOUT-01: include amount_kobo (= grossKobo) and provider so the
            // NOT NULL columns are satisfied. RETURNING id lets us detect the
            // ON CONFLICT DO NOTHING case and skip the earnings deduction (CRON-PAYOUT-02).
            const { rowCount: payoutInsertCount } = await tx.query(
              `INSERT INTO creator_payouts
                 (creator_id, amount_kobo, net_kobo, gross_kobo, platform_fee_kobo,
                  provider, status, idempotency_key, bank_account_snapshot, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
               ON CONFLICT (idempotency_key) DO NOTHING`,
              [candidate.creator_id, grossKobo, netKobo, grossKobo, platformFeeKobo,
               'paystack', status, idempotencyKey,
               bankSnapshot ? JSON.stringify(bankSnapshot) : null]
            );

            // CRON-PAYOUT-02: deduct gross earnings only when the INSERT actually
            // created a new row (not a duplicate).
            if ((payoutInsertCount ?? 0) > 0) {
              await tx.query(
                `UPDATE users
                 SET available_earnings_kobo = available_earnings_kobo - $1, updated_at = NOW()
                 WHERE id = $2`,
                [grossKobo, candidate.creator_id]
              );
            }
          });
          payoutsInitiated++;
        } catch {
          // Non-fatal — log per-creator failures separately
        }
      }
      results.weeklyAutomatedPayouts = { initiated: payoutsInitiated };
    }
  } catch (err) {
    errors.push(`weeklyAutomatedPayouts: ${String(err)}`);
  }

  // ============================================================
  // 34. Referral 7-day streak qualifying — award one-time bonuses
  //     (PRD §15) when referred users hit 7-day login streak
  // ============================================================

  try {
    const { getManifestValue } = await import("@/lib/manifest");
    const { creditCoins } = await import("@/lib/economy/coins");

    const qualifyingActionStr = await getManifestValue("referral_qualifying_action");
    const qualifyingAction = qualifyingActionStr ?? "coin_purchase";

    if (qualifyingAction === "login_streak_7" || qualifyingAction === "both") {
      // Hoist manifest reads before the transaction — they're global config and
      // should not be fetched once per referral (each call hits Redis/DB).
      const xpBonusStr = await getManifestValue("referral_tier1_xp_bonus");
      const coinBonusStr = await getManifestValue("referral_tier1_coin_bonus");
      const xpBonus = parseInt(xpBonusStr ?? "500", 10) || 500;
      const coinBonus = parseInt(coinBonusStr ?? "100", 10) || 100;

      const { safeAwardXP: _safeXP } = await import("@/lib/xp/safeAwardXP");
      const cronDate = new Date().toISOString().slice(0, 10);
      let streakQualified = 0;

      // Wrap the SELECT + processing in a single transaction so that FOR UPDATE
      // SKIP LOCKED holds the row locks until all updates are committed — without
      // a surrounding transaction the locks are released immediately after the
      // SELECT returns, allowing concurrent CRON runs to pick up the same rows.
      await db.transaction(async (tx) => {
        const { rows: streakReferrals } = await tx.query<{
          id: string;
          referrer_id: string;
          referred_id: string;
        }>(
          `SELECT r.id, r.referrer_id, r.referred_id
           FROM referrals r
           JOIN users u ON u.id = r.referred_id
           WHERE r.qualified = false
             AND r.tier = 1
             AND u.login_streak_days >= 7
             AND u.deleted_at IS NULL
           FOR UPDATE OF r SKIP LOCKED`
        );

        for (const referral of streakReferrals) {
          try {
            // Update referral record
            await tx.query(
              `UPDATE referrals SET qualified = true, qualified_at = NOW(),
                                   coin_reward = $1, xp_reward = $2
               WHERE id = $3`,
              [coinBonus, xpBonus, referral.id]
            );

            // Award XP inside the same transaction for atomicity
            const referralXpRef = `referral_streak_${referral.id}_${cronDate}`;
            await _safeXP(
              referral.referrer_id,
              xpBonus,
              "social",
              "referral_qualified_streak",
              referralXpRef,
              tx
            );

            // Award coins
            if (coinBonus > 0) {
              await creditCoins(
                referral.referrer_id,
                coinBonus,
                "referral_bonus",
                referral.id,
                "One-time referral bonus (7-day streak qualification)",
                {},
                tx
              );
            }

            streakQualified++;
          } catch (err) {
            console.error("[cron/33] Referral streak bonus error:", err);
          }
        }
      });

      results.referralStreakQualifying = { qualified: streakQualified };
    }
  } catch (err) {
    errors.push(`referralStreakQualifying: ${String(err)}`);
  }

  // 35. Flush Telegram delivery queue (PRD §20 — Admin In-App Messaging)
  // Admin broadcast messages enqueue Telegram IDs; this step actually sends them
  // and marks rows delivered. Batch size 200 to stay within Vercel response budget.
  try {
    const TELEGRAM_BATCH = 200;
    const { rows: queueRows } = await db.query<{
      id: string;
      broadcast_id: string;
      telegram_ids: string[];
      message_text: string | null;
    }>(
      `SELECT tdq.id, tdq.broadcast_id,
              tdq.telegram_ids,
              am.subject || E'\n\n' || am.body AS message_text
       FROM telegram_delivery_queue tdq
       JOIN admin_messages am ON am.id = tdq.broadcast_id
       WHERE tdq.delivered_at IS NULL
         AND tdq.failed_attempts < 3
       ORDER BY tdq.created_at ASC
       LIMIT $1`,
      [TELEGRAM_BATCH]
    );

    let telegramSent = 0;
    let telegramFailed = 0;

    for (const row of queueRows) {
      if (!row.telegram_ids?.length || !row.message_text) {
        // Mark as done so it doesn't block the queue
        await db.query(
          `UPDATE telegram_delivery_queue SET delivered_at = NOW() WHERE id = $1`,
          [row.id]
        ).catch(() => {});
        continue;
      }

      try {
        // BUG-08: await the send so failures are caught and delivered_at is not set prematurely
        await sendBulkTelegramMessages(
          row.telegram_ids.map((tid) => ({ telegramId: tid, text: row.message_text! }))
        );
        await db.query(
          `UPDATE telegram_delivery_queue SET delivered_at = NOW() WHERE id = $1`,
          [row.id]
        );
        telegramSent += row.telegram_ids.length;
      } catch {
        await db.query(
          `UPDATE telegram_delivery_queue
           SET failed_attempts = COALESCE(failed_attempts, 0) + 1
           WHERE id = $1`,
          [row.id]
        ).catch(() => {});
        telegramFailed++;
      }
    }

    results.telegramDelivery = { sent: telegramSent, failed: telegramFailed, batches: queueRows.length };
  } catch (err) {
    errors.push(`telegramDelivery: ${String(err)}`);
  }

  // Close expired Drop rooms (PRD §10 — Drop rooms have a fixed 2–6 hour window)
  try {
    const expiredDrops = await db.query<{ count: string }>(
      `WITH closed AS (
         UPDATE rooms
         SET is_active = FALSE, status = 'closed', updated_at = NOW()
         WHERE type IN ('drop', 'ceremony', 'event')
           AND drop_ends_at IS NOT NULL
           AND drop_ends_at < NOW()
           AND is_active = TRUE
         RETURNING id
       )
       SELECT COUNT(*) AS count FROM closed`
    );
    results.dropRoomExpiry = { closed: parseInt(expiredDrops.rows[0]?.count ?? "0") };
  } catch (err) {
    errors.push(`dropRoomExpiry: ${String(err)}`);
  }

  // SYS-01: Retry failed XP awards from dead-letter queue
  try {
    await retryFailedXPAwards();
    results.xpDlqRetry = { ok: true };
  } catch (err) {
    errors.push(`xpDlqRetry: ${String(err)}`);
  }

  // WEBHOOK-RETRY-01: Retry rows from failed_webhooks table (up to 3 attempts).
  // Each row stores the provider, event_type, and raw payload so handlers can
  // be re-invoked without the original HTTP request.
  try {
    const { rows: failedWebhooks } = await db.query<{
      id: string;
      provider: string;
      event_type: string;
      payload: string;
      retry_count: number;
    }>(
      `SELECT id, provider, event_type, payload::text AS payload, retry_count
       FROM failed_webhooks
       WHERE resolved = false
         AND retry_count < 3
         AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY created_at ASC
       LIMIT 50`
    );

    let webhookRetried = 0;
    let webhookResolved = 0;
    for (const row of failedWebhooks) {
      try {
        if (row.provider === 'paystack') {
          const { handlePaystackWebhookPayload } = await import('@/lib/payments/paystackWebhookHandler');
          await handlePaystackWebhookPayload(row.event_type, JSON.parse(row.payload));
        } else if (row.provider === 'dodopayments') {
          const { handleDodoWebhookPayload } = await import('@/lib/payments/dodoWebhookHandler');
          await handleDodoWebhookPayload(row.event_type, JSON.parse(row.payload));
        } else {
          // Unknown provider — skip and mark resolved to avoid infinite retry
          await db.query(
            `UPDATE failed_webhooks SET resolved = true, updated_at = NOW() WHERE id = $1`,
            [row.id]
          ).catch(() => {});
          continue;
        }
        // Success — mark resolved
        await db.query(
          `UPDATE failed_webhooks SET resolved = true, resolved_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [row.id]
        ).catch(() => {});
        webhookResolved++;
      } catch (retryErr) {
        // Retry failed — increment counter and schedule next attempt with backoff
        const nextRetry = new Date(Date.now() + Math.pow(2, row.retry_count + 1) * 60_000).toISOString();
        await db.query(
          `UPDATE failed_webhooks
           SET retry_count = retry_count + 1,
               last_error = $2,
               next_retry_at = $3,
               updated_at = NOW()
           WHERE id = $1`,
          [row.id, String(retryErr), nextRetry]
        ).catch(() => {});
        console.error('[cron/webhook-retry] Failed retry for webhook', row.id, retryErr);
      }
      webhookRetried++;
    }
    results.webhookRetry = { attempted: webhookRetried, resolved: webhookResolved };
  } catch (err) {
    errors.push(`webhookRetry: ${String(err)}`);
  }

  // PUSH-RECEIPT-01: Poll Expo push receipt stage 2 — resolve pending delivery confirmations
  try {
    const { pollPushReceipts } = await import('@/lib/notifications/push');
    const resolved = await pollPushReceipts();
    results.pushReceiptPoll = { resolved };
  } catch (err) {
    errors.push(`pushReceiptPoll: ${String(err)}`);
  }

  // PERF-CRON-01: Parallelize independent finalization steps.
  // SYS-02 (reconciliation) and SYS-04 (circuit metrics) are read-heavy and
  // touch disjoint tables, so they can run concurrently without conflicts.
  const [reconcileResult, circuitResult] = await Promise.allSettled([
    // SYS-02: Nightly coin + star ledger reconciliation
    (async () => {
      const coinDiscrepancies = await db.query<{
        user_id: string;
        ledger_sum: string;
        wallet_balance: string;
      }>(
        `SELECT cl.user_id,
                SUM(cl.amount)::bigint AS ledger_sum,
                u.coin_balance AS wallet_balance
           FROM coin_ledger cl
           JOIN users u ON u.id = cl.user_id
          WHERE u.deleted_at IS NULL
          GROUP BY cl.user_id, u.coin_balance
         HAVING SUM(cl.amount) <> u.coin_balance`
      );

      const starDiscrepancies = await db.query<{
        user_id: string;
        ledger_sum: string;
        wallet_balance: string;
      }>(
        `SELECT sl.user_id,
                SUM(sl.amount)::bigint AS ledger_sum,
                u.star_balance AS wallet_balance
           FROM star_ledger sl
           JOIN users u ON u.id = sl.user_id
          WHERE u.deleted_at IS NULL
          GROUP BY sl.user_id, u.star_balance
         HAVING SUM(sl.amount) <> u.star_balance`
      );

      for (const row of coinDiscrepancies.rows) {
        await db.query(
          `INSERT INTO audit_discrepancies (user_id, asset_type, ledger_sum, wallet_balance, detected_at)
           VALUES ($1, 'coins', $2, $3, NOW())
           ON CONFLICT (user_id, asset_type) DO UPDATE
             SET ledger_sum = EXCLUDED.ledger_sum,
                 wallet_balance = EXCLUDED.wallet_balance,
                 detected_at = EXCLUDED.detected_at,
                 resolved = FALSE`,
          [row.user_id, row.ledger_sum, row.wallet_balance]
        );
      }
      for (const row of starDiscrepancies.rows) {
        await db.query(
          `INSERT INTO audit_discrepancies (user_id, asset_type, ledger_sum, wallet_balance, detected_at)
           VALUES ($1, 'stars', $2, $3, NOW())
           ON CONFLICT (user_id, asset_type) DO UPDATE
             SET ledger_sum = EXCLUDED.ledger_sum,
                 wallet_balance = EXCLUDED.wallet_balance,
                 detected_at = EXCLUDED.detected_at,
                 resolved = FALSE`,
          [row.user_id, row.ledger_sum, row.wallet_balance]
        );
      }

      return {
        coinDiscrepancies: coinDiscrepancies.rows.length,
        starDiscrepancies: starDiscrepancies.rows.length,
      };
    })(),

    // SYS-04: Circuit breaker health (read-only)
    getAllCircuitMetrics().catch(() => []),
  ]);

  if (reconcileResult.status === "fulfilled") {
    results.ledgerReconciliation = reconcileResult.value;
  } else {
    errors.push(`ledgerReconciliation: ${String(reconcileResult.reason)}`);
  }

  results.circuitMetrics =
    circuitResult.status === "fulfilled" ? circuitResult.value : [];

  return NextResponse.json({
    success: errors.length === 0,
    results,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
  });
};
