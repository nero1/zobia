export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * app/api/cron/daily-guilds/route.ts
 *
 * CRON slot 4 of 7 — runs at 02:00 UTC (03:00 WAT).
 *
 *  1. Guild tier demotion (below minimum for 7+ days)
 *  2. Guild tier promotion (XP + member thresholds met)
 *  3. "The Patron" badge (top gifter in 3+ rooms last 24h)
 *  4. Guild contribution score alerts — FULLY SET-BASED (was N+1)
 *  5. Weekly guild quest reset (Mondays only) — batch INSERT
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateCronSecret, checkCronIdempotency } from "@/lib/cron/auth";

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

function getTierConfig(tier: string) {
  return GUILD_TIERS.find(t => t.name === tier);
}

function getDemotedTier(tier: string): string | null {
  const groupOrder = ['bronze', 'silver', 'gold', 'platinum', 'legend'];
  const group = tier.split('_')[0];
  const groupIdx = groupOrder.indexOf(group);
  if (groupIdx <= 0) return null;
  const prevGroup = groupOrder[groupIdx - 1];
  const prevTiers = GUILD_TIERS.filter(t => t.name.startsWith(prevGroup + '_'));
  return prevTiers[prevTiers.length - 1]?.name ?? null;
}

const GUILD_QUEST_TEMPLATES = [
  { title: "Send 1,000 messages this week", description: "Collectively send a combined 1,000 messages.", quest_type: "total_messages", target_count: 1000, xp_reward: 500, coin_reward: 200 },
  { title: "10+ members complete daily quests 3 days in a row", description: "Have at least 10 members each complete daily quests on 3 consecutive days.", quest_type: "daily_quest_streaks", target_count: 10, xp_reward: 750, coin_reward: 300 },
  { title: "Gift 5,000 coins to non-Guild members", description: "Collectively gift at least 5,000 coins to users outside your Guild.", quest_type: "external_gifts", target_count: 5000, xp_reward: 600, coin_reward: 250 },
];

export const GET = async (req: NextRequest) => {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const didClaim = await checkCronIdempotency("cron_daily_guilds_last_run", db);
  if (!didClaim) {
    return NextResponse.json({ skipped: true, reason: "Already ran today" });
  }

  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  // 1 & 2. Guild tier demotion + promotion
  try {
    const { rows: guilds } = await db.query<{
      id: string; captain_id: string; tier: string;
      member_count: number; below_min_since: string | null;
      guild_xp: number;
    }>(
      `SELECT g.id, g.captain_id, g.tier, g.guild_xp,
              COUNT(gm.user_id)::int AS member_count,
              g.below_min_since
       FROM guilds g
       LEFT JOIN guild_members gm ON gm.guild_id = g.id AND gm.left_at IS NULL
       WHERE g.deleted_at IS NULL
       GROUP BY g.id, g.captain_id, g.tier, g.guild_xp, g.below_min_since`
    );

    let demoted = 0, flagged = 0, promoted = 0;
    const now = new Date();
    const promoMap = new Map(GUILD_TIERS.map(t => [t.name, t]));

    // Collect changes for batch-notifying captains at end
    const demotionNotifs: [string, string, string, string][] = []; // [captainId, fromTier, toTier, guildId]
    const promotionNotifs: [string, string, string, string][] = [];

    for (const guild of guilds) {
      const tierConf = getTierConfig(guild.tier);
      const minMembers = tierConf?.minMembers ?? 0;
      const isBelowMin = guild.member_count < minMembers;
      const newTier = getDemotedTier(guild.tier);

      if (isBelowMin && !guild.below_min_since) {
        await db.query(`UPDATE guilds SET below_min_since = NOW(), updated_at = NOW() WHERE id = $1`, [guild.id]);
        flagged++;
      } else if (!isBelowMin && guild.below_min_since) {
        await db.query(`UPDATE guilds SET below_min_since = NULL, updated_at = NOW() WHERE id = $1`, [guild.id]);
      } else if (isBelowMin && guild.below_min_since && newTier) {
        const daysBelowMin = (now.getTime() - new Date(guild.below_min_since).getTime()) / 86_400_000;
        if (daysBelowMin >= 7) {
          const fromTier = guild.tier;
          await db.query(`UPDATE guilds SET tier = $2, below_min_since = NULL, updated_at = NOW() WHERE id = $1`, [guild.id, newTier]);
          await db.query(
            `INSERT INTO guild_tier_history (guild_id, from_tier, to_tier, guild_xp_at, changed_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [guild.id, fromTier, newTier, guild.guild_xp]
          ).catch(() => {});
          demotionNotifs.push([guild.captain_id, fromTier, newTier, guild.id]);
          demoted++;
          continue;
        }
      }

      // Promotion check — skipped in the same iteration as a demotion (continue above)
      const threshold = promoMap.get(guild.tier);
      if (threshold?.next && guild.guild_xp >= threshold.promotionXP && guild.member_count >= threshold.minMembers) {
        const fromTier = guild.tier;
        const toTier = threshold.next;
        await db.query(`UPDATE guilds SET tier = $2, updated_at = NOW() WHERE id = $1`, [guild.id, toTier]);
        await db.query(
          `INSERT INTO guild_tier_history (guild_id, from_tier, to_tier, guild_xp_at, changed_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [guild.id, fromTier, toTier, guild.guild_xp]
        ).catch(() => {});
        promotionNotifs.push([guild.captain_id, fromTier, toTier, guild.id]);
        promoted++;
      }
    }

    // Batch demotion notifications
    if (demotionNotifs.length > 0) {
      await db.query(
        `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
         SELECT sub.captain_id, 'guild_tier_demoted', 'Guild Tier Update',
                'Your guild has moved from ' || sub.from_tier || ' to ' || sub.to_tier || ' tier.',
                jsonb_build_object('guildId', sub.guild_id, 'fromTier', sub.from_tier, 'toTier', sub.to_tier),
                false, NOW()
         FROM (SELECT unnest($1::uuid[]) AS captain_id,
                      unnest($2::text[]) AS from_tier,
                      unnest($3::text[]) AS to_tier,
                      unnest($4::text[]) AS guild_id) sub`,
        [
          demotionNotifs.map(n => n[0]),
          demotionNotifs.map(n => n[1]),
          demotionNotifs.map(n => n[2]),
          demotionNotifs.map(n => n[3]),
        ]
      ).catch(() => {});
    }
    if (promotionNotifs.length > 0) {
      await db.query(
        `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
         SELECT sub.captain_id, 'guild_tier_promoted', 'Guild Promoted!',
                'Your guild has been promoted from ' || sub.from_tier || ' to ' || sub.to_tier || ' tier.',
                jsonb_build_object('guildId', sub.guild_id, 'fromTier', sub.from_tier, 'toTier', sub.to_tier),
                false, NOW()
         FROM (SELECT unnest($1::uuid[]) AS captain_id,
                      unnest($2::text[]) AS from_tier,
                      unnest($3::text[]) AS to_tier,
                      unnest($4::text[]) AS guild_id) sub`,
        [
          promotionNotifs.map(n => n[0]),
          promotionNotifs.map(n => n[1]),
          promotionNotifs.map(n => n[2]),
          promotionNotifs.map(n => n[3]),
        ]
      ).catch(() => {});
    }

    results.guildTierDemotion = { demoted, flagged };
    results.guildTierPromotions = promoted;
  } catch (err) {
    errors.push(`guildTiers: ${String(err)}`);
  }

  // 3. "The Patron" badge
  try {
    const { rows: patronCandidates } = await db.query<{ user_id: string; room_count: string }>(
      `WITH room_totals AS (
         SELECT room_id, sender_id, SUM(coin_cost) AS total_coins
         FROM gifts
         WHERE created_at >= NOW() - INTERVAL '24 hours' AND room_id IS NOT NULL
         GROUP BY room_id, sender_id
       ),
       top_gifters AS (
         SELECT DISTINCT ON (room_id) room_id, sender_id
         FROM room_totals ORDER BY room_id, total_coins DESC
       )
       SELECT sender_id AS user_id, COUNT(*)::text AS room_count
       FROM top_gifters GROUP BY sender_id HAVING COUNT(*) >= 3`
    );

    if (patronCandidates.length > 0) {
      await db.query(
        `INSERT INTO user_badges (user_id, badge_type, badge_key, awarded_at, metadata)
         SELECT sub.user_id, 'patron', 'patron', NOW(),
                jsonb_build_object('roomCount', sub.room_count::int, 'awardedAt', NOW()::text)
         FROM (SELECT unnest($1::uuid[]) AS user_id, unnest($2::int[]) AS room_count) sub
         ON CONFLICT (user_id, badge_key) DO UPDATE SET awarded_at = NOW(), metadata = EXCLUDED.metadata`,
        [
          patronCandidates.map(c => c.user_id),
          patronCandidates.map(c => parseInt(c.room_count)),
        ]
      ).catch(() => {});
    }
    results.patronBadge = { awarded: patronCandidates.length };
  } catch (err) {
    errors.push(`patronBadge: ${String(err)}`);
  }

  // 4. Guild contribution alerts — fully set-based (replaces N+1 loop)
  try {
    // Single CTE: compute guild averages, find below-threshold members,
    // batch-upsert alerts, and return data needed for notifications.
    const { rows: alertRows } = await db.query<{
      guild_id: string;
      user_id: string;
      weeks_below: number;
      contribution_score: number;
      avg_score: number;
    }>(
      `WITH guild_avgs AS (
         SELECT gm.guild_id,
                ROUND(AVG(COALESCE(gm.contribution_score, 0)))::int AS avg_score
         FROM guild_members gm
         JOIN guilds g ON g.id = gm.guild_id
         WHERE gm.left_at IS NULL AND g.deleted_at IS NULL AND g.is_active = TRUE
         GROUP BY gm.guild_id
         HAVING AVG(COALESCE(gm.contribution_score, 0)) > 0
       ),
       low_members AS (
         SELECT gm.guild_id, gm.user_id,
                COALESCE(gm.contribution_score, 0) AS contribution_score,
                ga.avg_score
         FROM guild_members gm
         JOIN guild_avgs ga ON ga.guild_id = gm.guild_id
         WHERE gm.left_at IS NULL
           AND COALESCE(gm.contribution_score, 0) < ga.avg_score * 0.5
       ),
       upserted AS (
         INSERT INTO guild_contribution_alerts (guild_id, user_id, weeks_below, alerted_at)
         SELECT guild_id, user_id, 1, NOW()
         FROM low_members
         ON CONFLICT (guild_id, user_id) DO UPDATE
           SET weeks_below = guild_contribution_alerts.weeks_below + 1,
               alerted_at  = NOW()
         RETURNING guild_id, user_id, weeks_below
       )
       SELECT u.guild_id, u.user_id, u.weeks_below,
              lm.contribution_score, lm.avg_score
       FROM upserted u
       JOIN low_members lm ON lm.guild_id = u.guild_id AND lm.user_id = u.user_id`
    );

    if (alertRows.length > 0) {
      // Batch insert member notifications
      await db.query(
        `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
         SELECT sub.user_id,
                'guild_low_contribution',
                'Guild Contribution Alert',
                'Your contribution score is below the guild average for ' || sub.weeks_below::text || ' week' ||
                  CASE WHEN sub.weeks_below != 1 THEN 's' ELSE '' END || '.',
                jsonb_build_object(
                  'guildId', sub.guild_id::text,
                  'contributionScore', sub.contribution_score,
                  'guildAverage', sub.avg_score,
                  'weeksBelow', sub.weeks_below
                ),
                false, NOW()
         FROM (SELECT unnest($1::uuid[])  AS user_id,
                      unnest($2::uuid[])  AS guild_id,
                      unnest($3::int[])   AS weeks_below,
                      unnest($4::int[])   AS contribution_score,
                      unnest($5::int[])   AS avg_score) sub`,
        [
          alertRows.map(r => r.user_id),
          alertRows.map(r => r.guild_id),
          alertRows.map(r => r.weeks_below),
          alertRows.map(r => r.contribution_score),
          alertRows.map(r => r.avg_score),
        ]
      ).catch(() => {});
    }

    // Clean up healed members from alerts table — single set-based DELETE
    await db.query(
      `DELETE FROM guild_contribution_alerts gca
       USING guilds g
       LEFT JOIN (
         SELECT gm2.guild_id, AVG(COALESCE(gm2.contribution_score, 0)) AS avg_score
         FROM guild_members gm2 WHERE gm2.left_at IS NULL
         GROUP BY gm2.guild_id
       ) ga2 ON ga2.guild_id = g.id
       WHERE gca.guild_id = g.id
         AND g.deleted_at IS NULL AND g.is_active = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM guild_members gm3
           WHERE gm3.guild_id = gca.guild_id AND gm3.user_id = gca.user_id
             AND gm3.left_at IS NULL
             AND COALESCE(gm3.contribution_score, 0) < COALESCE(ga2.avg_score * 0.5, 0)
         )`
    ).catch(() => {});

    results.guildContributionAlerts = { alertsSent: alertRows.length };
  } catch (err) {
    errors.push(`guildContributionAlerts: ${String(err)}`);
  }

  // 5. Weekly guild quest reset (Mondays only) — batch INSERT
  try {
    if (new Date().getUTCDay() === 1) {
      const today = new Date();
      const weekStart = today.toISOString().slice(0, 10);
      const weekEndDate = new Date(today);
      weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6);
      const weekEnd = weekEndDate.toISOString().slice(0, 10);

      // Expire old incomplete quests for all guilds in one query
      await db.query(
        `UPDATE guild_quests SET is_active = false
         WHERE week_end < $1 AND is_completed = false AND is_active = true`,
        [weekStart]
      ).catch(() => {});

      // Get all active guilds
      const { rows: guilds } = await db.query<{ id: string }>(
        `SELECT id FROM guilds WHERE deleted_at IS NULL AND is_active = TRUE`
      );

      // Batch INSERT all guild × template combinations
      const guildIds: string[] = [];
      const titles: string[] = [];
      const descriptions: string[] = [];
      const questTypes: string[] = [];
      const targetCounts: number[] = [];
      const xpRewards: number[] = [];
      const coinRewards: number[] = [];
      const weekStarts: string[] = [];
      const weekEnds: string[] = [];

      for (const guild of guilds) {
        for (const t of GUILD_QUEST_TEMPLATES) {
          guildIds.push(guild.id);
          titles.push(t.title);
          descriptions.push(t.description);
          questTypes.push(t.quest_type);
          targetCounts.push(t.target_count);
          xpRewards.push(t.xp_reward);
          coinRewards.push(t.coin_reward);
          weekStarts.push(weekStart);
          weekEnds.push(weekEnd);
        }
      }

      let questsCreated = 0;
      if (guildIds.length > 0) {
        const { rowCount } = await db.query(
          `INSERT INTO guild_quests
             (guild_id, title, description, quest_type, target_count, current_count,
              reward_guild_xp, reward_coins, week_start, week_end, is_completed, is_active, created_at)
           SELECT unnest($1::uuid[]), unnest($2::text[]), unnest($3::text[]), unnest($4::text[]),
                  unnest($5::int[]), 0,
                  unnest($6::int[]), unnest($7::int[]),
                  unnest($8::date[]), unnest($9::date[]),
                  false, true, NOW()
           ON CONFLICT DO NOTHING`,
          [guildIds, titles, descriptions, questTypes, targetCounts, xpRewards, coinRewards, weekStarts, weekEnds]
        ).catch(() => ({ rowCount: 0 }));
        questsCreated = rowCount ?? 0;
      }

      // Batch notify guild captains + veterans — single INSERT...SELECT
      if (guilds.length > 0) {
        await db.query(
          `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
           SELECT gm.user_id, 'guild_quests_reset', 'New Weekly Quests',
                  'Your guild''s weekly quests have been reset. Complete them to earn rewards!',
                  jsonb_build_object('guildId', gm.guild_id::text, 'weekStart', $1::text),
                  false, NOW()
           FROM guild_members gm
           WHERE gm.left_at IS NULL AND gm.role IN ('captain', 'veteran')
             AND gm.guild_id = ANY($2::uuid[])`,
          [weekStart, guilds.map(g => g.id)]
        ).catch(() => {});
      }

      results.guildQuestReset = { ran: true, guildsProcessed: guilds.length, questsCreated, weekStart, weekEnd };
    } else {
      results.guildQuestReset = { ran: false, reason: "Not Monday" };
    }
  } catch (err) {
    errors.push(`guildQuestReset: ${String(err)}`);
  }

  return NextResponse.json({
    success: errors.length === 0,
    results,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
  });
};
