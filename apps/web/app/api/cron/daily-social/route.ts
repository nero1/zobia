export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * app/api/cron/daily-social/route.ts
 *
 * CRON slot 6 of 7 — runs at 04:00 UTC (05:00 WAT).
 *
 *  1. Nemesis assignments refresh (Sundays only)
 *  2. Weekly season leaderboard snapshot (Sundays only)
 *  3. Leaderboard ripple notifications (set-based, already fast)
 *  4. DM conversation score sticker milestones — fully set-based (was N+1)
 *  5. Trust score batch recalculation — single query (was per-user loop)
 *  6. Earnable sticker pack auto-unlock — fully set-based
 *  7. Creator tier progression — single UPDATE...FROM CTE (was per-creator loop)
 *  8. Nemesis overtake/triumph notifications (Sundays only)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateCronSecret, checkCronIdempotency } from "@/lib/cron/auth";
import { refreshNemesisAssignments } from "@/lib/nemesis/nemesisEngine";
import { batchCalculateTrustScores } from "@/lib/trust/trustScore";

const STICKER_MILESTONES = [50, 100, 200, 365] as const;

export const GET = async (req: NextRequest) => {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const didClaim = await checkCronIdempotency("cron_daily_social_last_run", db);
  if (!didClaim) {
    return NextResponse.json({ skipped: true, reason: "Already ran today" });
  }

  const results: Record<string, unknown> = {};
  const errors: string[] = [];
  const dayOfWeek = new Date().getUTCDay();
  const isSunday = dayOfWeek === 0;

  // 1. Nemesis assignments (Sundays only)
  try {
    if (isSunday) {
      results.nemesisRefresh = await refreshNemesisAssignments(db);
    } else {
      results.nemesisRefresh = { skipped: true, reason: "Not Sunday" };
    }
  } catch (err) {
    errors.push(`nemesisRefresh: ${String(err)}`);
  }

  // 2. Weekly season leaderboard snapshot (Sundays only)
  try {
    if (isSunday) {
      const { rows: activeSeasons } = await db.query<{ id: string; name: string; starts_at: string }>(
        `SELECT id, name, starts_at FROM seasons WHERE is_active = TRUE LIMIT 1`
      );
      if (activeSeasons[0]) {
        const season = activeSeasons[0];
        const seasonScope = `season:${season.id}`;
        await db.query(`DELETE FROM leaderboard_rank_snapshots WHERE scope = $1`, [seasonScope]);
        await db.query(
          `INSERT INTO leaderboard_rank_snapshots (user_id, scope, rank, xp, snapped_at)
           SELECT ls.user_id, $2,
                  ROW_NUMBER() OVER (ORDER BY ls.xp_value DESC) AS rank,
                  ls.xp_value, NOW()
           FROM leaderboard_snapshots ls
           JOIN users u ON u.id = ls.user_id
           WHERE ls.season_id = $1 AND ls.scope = 'season' AND u.deleted_at IS NULL
           ORDER BY ls.xp_value DESC LIMIT 200
           ON CONFLICT (user_id, scope) DO UPDATE
             SET rank = EXCLUDED.rank, xp = EXCLUDED.xp, snapped_at = EXCLUDED.snapped_at`,
          [season.id, seasonScope]
        );

        // Award season_top100_frame badge (weeks 6+)
        const weekNum = Math.ceil((Date.now() - new Date(season.starts_at).getTime()) / (7 * 86_400_000));
        if (weekNum >= 6) {
          await db.query(
            `INSERT INTO user_badges (user_id, badge_type, badge_key, reference_id, awarded_at)
             SELECT ls.user_id, 'season_top100_frame', 'season_top100_frame:s' || $1::text, $1, NOW()
             FROM (
               SELECT ls.user_id, ROW_NUMBER() OVER (ORDER BY ls.xp_value DESC) AS rank
               FROM leaderboard_snapshots ls JOIN users u ON u.id = ls.user_id
               WHERE ls.season_id = $1 AND ls.scope = 'season' AND u.deleted_at IS NULL
             ) ls WHERE ls.rank BETWEEN 11 AND 100
             ON CONFLICT (user_id, badge_key) WHERE badge_key IS NOT NULL DO NOTHING`,
            [season.id]
          ).catch(() => {});
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

  // 3. Leaderboard ripple notifications (already set-based — keep as-is)
  try {
    const { rows: currentRanks } = await db.query<{ user_id: string; rank: string; xp_value: string }>(
      `SELECT user_id, RANK() OVER (ORDER BY xp_value DESC)::text AS rank, xp_value::text
       FROM leaderboard_snapshots WHERE track = 'main' AND scope = 'global' AND season_id IS NULL`
    );
    let notified = 0;
    if (currentRanks.length > 0) {
      const userIds = currentRanks.map(r => r.user_id);
      const { rows: prevSnapshots } = await db.query<{ user_id: string; rank: number; xp: number }>(
        `SELECT user_id, rank, xp FROM leaderboard_rank_snapshots WHERE scope = 'global' AND user_id = ANY($1::uuid[])`,
        [userIds]
      );
      const prevByUser = new Map(prevSnapshots.map(p => [p.user_id, p]));

      const notifUserIds: string[] = [], notifDirections: string[] = [], notifFromRanks: number[] = [], notifToRanks: number[] = [];
      const snapUserIds: string[] = [], snapRanks: number[] = [], snapXps: number[] = [];

      for (const current of currentRanks) {
        const currentRank = parseInt(current.rank);
        const currentXp   = parseInt(current.xp_value);
        const prev = prevByUser.get(current.user_id);
        if (prev && prev.rank !== currentRank && Math.abs(prev.rank - currentRank) >= 5) {
          notifUserIds.push(current.user_id);
          notifDirections.push(currentRank < prev.rank ? 'up' : 'down');
          notifFromRanks.push(prev.rank);
          notifToRanks.push(currentRank);
        }
        snapUserIds.push(current.user_id);
        snapRanks.push(currentRank);
        snapXps.push(currentXp);
      }

      if (snapUserIds.length > 0) {
        await db.query(
          `INSERT INTO leaderboard_rank_snapshots (user_id, scope, rank, xp, snapped_at)
           SELECT unnest($1::uuid[]), 'global', unnest($2::int[]), unnest($3::int[]), NOW()
           ON CONFLICT (user_id, scope) DO UPDATE SET rank = EXCLUDED.rank, xp = EXCLUDED.xp, snapped_at = NOW()`,
          [snapUserIds, snapRanks, snapXps]
        ).catch(() => {});
      }
      if (notifUserIds.length > 0) {
        await db.query(
          `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
           SELECT sub.user_id, 'rank_change',
                  CASE WHEN sub.direction = 'up' THEN 'Your rank improved!' ELSE 'Your rank dropped' END,
                  'Your position on the global leaderboard changed.',
                  jsonb_build_object('direction', sub.direction, 'fromRank', sub.from_rank, 'toRank', sub.to_rank),
                  false, NOW()
           FROM (SELECT unnest($1::uuid[]) AS user_id, unnest($2::text[]) AS direction,
                        unnest($3::int[]) AS from_rank, unnest($4::int[]) AS to_rank) sub`,
          [notifUserIds, notifDirections, notifFromRanks, notifToRanks]
        ).catch(() => {});
        notified = notifUserIds.length;
      }
    }
    results.leaderboardRipple = { notified, snapshotCount: currentRanks.length };
  } catch (err) {
    errors.push(`leaderboardRipple: ${String(err)}`);
  }

  // 4. DM sticker milestones — fully set-based (was N+1 over conversations × milestones)
  try {
    const { rows: newMilestones } = await db.query<{
      user_id_a: string;
      user_id_b: string;
      milestone_score: number;
      pack_id: string | null;
    }>(
      `WITH milestones(m) AS (VALUES ${STICKER_MILESTONES.map(m => `(${m})`).join(',')}),
       eligible AS (
         SELECT cs.user_id_1, cs.user_id_2, m.m AS milestone
         FROM conversation_scores cs
         JOIN milestones m ON cs.score >= m.m
         WHERE NOT EXISTS (
           SELECT 1 FROM dm_conversation_score_milestones dsm
           WHERE dsm.user_id_a = cs.user_id_1 AND dsm.user_id_b = cs.user_id_2
             AND dsm.milestone_score = m.m
         )
       ),
       inserted AS (
         INSERT INTO dm_conversation_score_milestones (user_id_a, user_id_b, milestone_score, awarded_at)
         SELECT user_id_1, user_id_2, milestone, NOW() FROM eligible
         ON CONFLICT DO NOTHING
         RETURNING user_id_a, user_id_b, milestone_score
       )
       SELECT i.user_id_a, i.user_id_b, i.milestone_score, sp.id AS pack_id
       FROM inserted i
       LEFT JOIN sticker_packs sp ON sp.name = 'dm_streak_' || i.milestone_score::text AND sp.is_active = TRUE`
    );

    if (newMilestones.length > 0) {
      // Batch grant packs to both users
      const packGrants = newMilestones.filter(r => r.pack_id);
      if (packGrants.length > 0) {
        const packUserIds: string[] = [];
        const packIds: string[] = [];
        for (const r of packGrants) {
          packUserIds.push(r.user_id_a, r.user_id_b);
          packIds.push(r.pack_id!, r.pack_id!);
        }
        await db.query(
          `INSERT INTO user_sticker_packs (user_id, pack_id, unlocked_at)
           SELECT unnest($1::uuid[]), unnest($2::uuid[]), NOW()
           ON CONFLICT (user_id, pack_id) DO NOTHING`,
          [packUserIds, packIds]
        ).catch(() => {});
      }

      // Batch notifications for both sides of each pair
      await db.query(
        `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
         SELECT sub.uid, 'dm_sticker_unlock', 'Sticker Pack Unlocked!',
                'Your ' || sub.milestone::text || '-day conversation streak unlocked exclusive sticker reactions!',
                jsonb_build_object('milestone', sub.milestone, 'otherUserId', sub.other_uid::text),
                false, NOW()
         FROM (
           SELECT user_id_a AS uid, user_id_b AS other_uid, milestone_score AS milestone
             FROM (SELECT unnest($1::uuid[]) AS user_id_a, unnest($2::uuid[]) AS user_id_b, unnest($3::int[]) AS milestone_score) t
           UNION ALL
           SELECT user_id_b AS uid, user_id_a AS other_uid, milestone_score AS milestone
             FROM (SELECT unnest($1::uuid[]) AS user_id_a, unnest($2::uuid[]) AS user_id_b, unnest($3::int[]) AS milestone_score) t
         ) sub`,
        [newMilestones.map(r => r.user_id_a), newMilestones.map(r => r.user_id_b), newMilestones.map(r => r.milestone_score)]
      ).catch(() => {});
    }
    results.stickerUnlocks = { unlocked: newMilestones.length };
  } catch (err) {
    errors.push(`stickerUnlocks: ${String(err)}`);
  }

  // 5. Trust score batch recalculation (replaces per-user calculateTrustScore loop)
  try {
    const { rows: staleUsers } = await db.query<{ id: string }>(
      `SELECT DISTINCT u.id FROM users u
       WHERE u.deleted_at IS NULL AND (
         EXISTS (SELECT 1 FROM reports r WHERE r.reported_user_id = u.id AND r.created_at >= NOW() - INTERVAL '24 hours')
         OR EXISTS (SELECT 1 FROM payments p WHERE p.user_id = u.id AND p.status = 'completed' AND p.created_at >= NOW() - INTERVAL '24 hours')
         OR EXISTS (SELECT 1 FROM moderation_actions ma WHERE ma.target_user_id = u.id AND ma.created_at >= NOW() - INTERVAL '24 hours')
       )
       LIMIT 500`
    );
    if (staleUsers.length > 0) {
      await batchCalculateTrustScores(staleUsers.map(u => u.id), db);
    }
    results.trustScoreUpdates = { updated: staleUsers.length };
  } catch (err) {
    errors.push(`trustScoreUpdates: ${String(err)}`);
  }

  // 6. Earnable sticker pack auto-unlock — fully set-based
  try {
    const { rows: newUnlocks } = await db.query<{ user_id: string; pack_id: string; pack_name: string; track: string; level: number }>(
      `WITH new_grants AS (
         INSERT INTO user_sticker_packs (user_id, pack_id, unlocked_at)
         SELECT u.id, sp.id, NOW()
         FROM sticker_packs sp
         CROSS JOIN users u
         WHERE sp.pack_type = 'earnable' AND sp.is_active = TRUE AND sp.unlock_condition IS NOT NULL
           AND sp.unlock_condition ~ '^[a-z_]+_level_[0-9]+$'
           AND u.deleted_at IS NULL
           AND CASE
             WHEN sp.unlock_condition LIKE 'social_level_%'      THEN u.level_social
             WHEN sp.unlock_condition LIKE 'creator_level_%'     THEN u.level_creator
             WHEN sp.unlock_condition LIKE 'competitor_level_%'  THEN u.level_competitor
             WHEN sp.unlock_condition LIKE 'generosity_level_%'  THEN u.level_generosity
             WHEN sp.unlock_condition LIKE 'knowledge_level_%'   THEN u.level_knowledge
             WHEN sp.unlock_condition LIKE 'explorer_level_%'    THEN u.level_explorer
             ELSE 0
           END >= CAST(REGEXP_REPLACE(sp.unlock_condition, '^[a-z_]+_level_', '') AS INTEGER)
           AND NOT EXISTS (
             SELECT 1 FROM user_sticker_packs usp WHERE usp.user_id = u.id AND usp.pack_id = sp.id
           )
         ON CONFLICT DO NOTHING
         RETURNING user_id, pack_id
       )
       SELECT ng.user_id, ng.pack_id, sp.name AS pack_name,
              SPLIT_PART(sp.unlock_condition, '_level_', 1) AS track,
              CAST(SPLIT_PART(sp.unlock_condition, '_level_', 2) AS INTEGER) AS level
       FROM new_grants ng
       JOIN sticker_packs sp ON sp.id = ng.pack_id`
    );

    if (newUnlocks.length > 0) {
      await db.query(
        `INSERT INTO notifications (user_id, type, title, body, metadata, created_at)
         SELECT sub.user_id, 'sticker_pack_unlocked', 'New Sticker Pack!',
                'You unlocked the "' || sub.pack_name || '" sticker pack through your progression!',
                jsonb_build_object('packId', sub.pack_id::text, 'track', sub.track, 'level', sub.level),
                NOW()
         FROM (SELECT unnest($1::uuid[]) AS user_id, unnest($2::uuid[]) AS pack_id,
                      unnest($3::text[]) AS pack_name, unnest($4::text[]) AS track,
                      unnest($5::int[])  AS level) sub`,
        [
          newUnlocks.map(r => r.user_id),
          newUnlocks.map(r => r.pack_id),
          newUnlocks.map(r => r.pack_name),
          newUnlocks.map(r => r.track),
          newUnlocks.map(r => r.level),
        ]
      ).catch(() => {});
    }
    results.earnableStickerUnlocks = { unlocked: newUnlocks.length };
  } catch (err) {
    errors.push(`earnableStickerUnlocks: ${String(err)}`);
  }

  // 7. Creator tier progression — single UPDATE...FROM CTE (was per-creator loop)
  try {
    const { rowCount: tierUpdates } = await db.query(
      `UPDATE users u
       SET creator_tier = tc.new_tier, updated_at = NOW()
       FROM (
         SELECT r.creator_id,
           CASE
             WHEN SUM(rm.member_count) >= 5000 THEN 'icon'
             WHEN SUM(rm.member_count) >= 2000 THEN 'elite'
             WHEN SUM(rm.member_count) >= 500  THEN 'verified'
             WHEN SUM(rm.member_count) >= 100  THEN 'rising'
             ELSE 'rookie'
           END AS new_tier
         FROM rooms r
         JOIN LATERAL (
           SELECT COUNT(*)::int AS member_count FROM room_members rmp
           WHERE rmp.room_id = r.id AND rmp.left_at IS NULL
         ) rm ON TRUE
         WHERE r.deleted_at IS NULL AND r.is_active = TRUE
         GROUP BY r.creator_id
       ) tc
       WHERE u.id = tc.creator_id
         AND u.is_creator = TRUE
         AND COALESCE(u.creator_tier, 'rookie') != tc.new_tier`
    );
    results.creatorTierUpdates = { updated: tierUpdates ?? 0 };
  } catch (err) {
    errors.push(`creatorTierUpdates: ${String(err)}`);
  }

  // 8. Nemesis notifications (Sundays only)
  try {
    if (isSunday) {
      const { rows: overtakeRows } = await db.query<{ user_id: string; nemesis_user_id: string; user_xp: number; nemesis_xp: number }>(
        `SELECT na.user_id, na.nemesis_user_id, u.xp_total AS user_xp, n.xp_total AS nemesis_xp
         FROM nemesis_assignments na
         JOIN users u ON u.id = na.user_id
         JOIN users n ON n.id = na.nemesis_user_id
         WHERE n.xp_total > u.xp_total
           AND (na.last_notified_at IS NULL OR na.last_notified_at < NOW() - INTERVAL '6 days')`
      );

      if (overtakeRows.length > 0) {
        // Batch insert both notification types
        await db.query(
          `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
           SELECT sub.uid, sub.type, sub.title, sub.body, sub.meta, false, NOW()
           FROM (
             SELECT user_id AS uid, 'nemesis_overtook_you' AS type,
                    'Your Nemesis pulled ahead!' AS title,
                    'Your rival has overtaken you in XP. Time to catch up!' AS body,
                    jsonb_build_object('nemesisId', nemesis_user_id::text, 'userXp', user_xp, 'nemesisXp', nemesis_xp, 'gap', nemesis_xp - user_xp) AS meta
               FROM (SELECT unnest($1::uuid[]) AS user_id, unnest($2::uuid[]) AS nemesis_user_id, unnest($3::int[]) AS user_xp, unnest($4::int[]) AS nemesis_xp) t
             UNION ALL
             SELECT nemesis_user_id AS uid, 'nemesis_triumph' AS type,
                    'You overtook your Nemesis!' AS title,
                    'You have surpassed your rival in XP. Keep the lead!' AS body,
                    jsonb_build_object('targetId', user_id::text, 'gap', nemesis_xp - user_xp) AS meta
               FROM (SELECT unnest($1::uuid[]) AS user_id, unnest($2::uuid[]) AS nemesis_user_id, unnest($3::int[]) AS user_xp, unnest($4::int[]) AS nemesis_xp) t
           ) sub
           ON CONFLICT DO NOTHING`,
          [
            overtakeRows.map(r => r.user_id),
            overtakeRows.map(r => r.nemesis_user_id),
            overtakeRows.map(r => r.user_xp),
            overtakeRows.map(r => r.nemesis_xp),
          ]
        ).catch(() => {});

        // Batch push notifications fire-and-forget
        const { sendPushNotificationBatch } = await import('@/lib/notifications/push');
        sendPushNotificationBatch([
          ...overtakeRows.map(r => ({ userId: r.user_id, title: '📊 Your Nemesis pulled ahead!', body: `Your rival is now ${r.nemesis_xp - r.user_xp} XP ahead.`, data: { action: '/nemesis', type: 'nemesis_overtook_you' } })),
          ...overtakeRows.map(r => ({ userId: r.nemesis_user_id, title: '🏆 You overtook your Nemesis!', body: `You're ${r.nemesis_xp - r.user_xp} XP ahead of your rival.`, data: { action: '/nemesis', type: 'nemesis_triumph' } })),
        ]).catch(() => {});

        const allAffectedIds = [...new Set([...overtakeRows.map(r => r.user_id), ...overtakeRows.map(r => r.nemesis_user_id)])];
        await db.query(
          `UPDATE nemesis_assignments SET last_notified_at = NOW()
           WHERE user_id = ANY($1::uuid[]) OR nemesis_user_id = ANY($1::uuid[])`,
          [allAffectedIds]
        ).catch(() => {});
      }
      results.nemesisNotifications = { overtakes: overtakeRows.length };
    }
  } catch (err) {
    errors.push(`nemesisNotifications: ${String(err)}`);
  }

  return NextResponse.json({
    success: errors.length === 0,
    results,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
  });
};
