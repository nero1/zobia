export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * app/api/cron/leaderboards/route.ts
 *
 * 15-minute CRON handler for live leaderboard updates.
 *
 * Called every 15 minutes via cron-jobs.org:
 *   URL: /api/cron/leaderboards
 *   Header: Authorization: Bearer <CRON_SECRET>
 *
 * Responsibilities (idempotent — safe to call multiple times):
 *  1. Find users who have earned XP in the last 15 minutes (active users).
 *  2. Batch-upsert leaderboard_snapshots for all active users × all 8 tracks
 *     in a SINGLE INSERT using unnest() — replaces 7 serial calls per user.
 *  3. Detect rank changes since the previous snapshot.
 *  4. Batch-update last_notified_rank + batch-insert rank-change notifications
 *     using unnest() — replaces per-user UPDATE + INSERT loop.
 *
 * Returns { usersUpdated, rankChanges }
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

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

function validateCronSecret(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  return isValidSecret(token, cronSecret);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTIVE_WINDOW_MINUTES = 15;

const TRACKS = ['main', 'social', 'creator', 'competitor', 'generosity', 'knowledge', 'explorer', 'gaming'] as const;

interface ActiveUserRow {
  user_id: string;
  xp_total: number;
  xp_social: number;
  xp_creator: number;
  xp_competitor: number;
  xp_generosity: number;
  xp_knowledge: number;
  xp_explorer: number;
  xp_gaming: number;
  rank_name: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - ACTIVE_WINDOW_MINUTES * 60 * 1000);

  let usersUpdated = 0;
  let rankChanges = 0;
  const errors: string[] = [];

  // -------------------------------------------------------------------------
  // Step 1: Find users with recent XP activity
  // -------------------------------------------------------------------------
  let activeUsers: ActiveUserRow[] = [];
  try {
    const result = await db.query<ActiveUserRow>(
      `SELECT DISTINCT ON (xl.user_id)
              xl.user_id,
              u.xp_total,
              u.xp_social,
              u.xp_creator,
              u.xp_competitor,
              u.xp_generosity,
              u.xp_knowledge,
              u.xp_explorer,
              u.xp_gaming,
              u.rank_name
       FROM xp_ledger xl
       JOIN users u ON u.id = xl.user_id
       WHERE xl.created_at >= $1
         AND u.is_banned = false
         AND u.deleted_at IS NULL
       ORDER BY xl.user_id`,
      [windowStart.toISOString()]
    );
    activeUsers = result.rows;
  } catch (err) {
    errors.push(`activeUserQuery: ${String(err)}`);
    return NextResponse.json({ ok: false, errors, timestamp: now.toISOString() }, { status: 500 });
  }

  if (activeUsers.length === 0) {
    return NextResponse.json({ ok: true, usersUpdated: 0, rankChanges: 0, timestamp: now.toISOString() });
  }

  const userIds = activeUsers.map((u) => u.user_id);

  // -------------------------------------------------------------------------
  // Step 2: Batch-fetch previous snapshot ranks (single query, all users)
  // -------------------------------------------------------------------------
  const previousRankMap = new Map<string, number>();
  try {
    const { rows: prevRows } = await db.query<{ user_id: string; last_notified_rank: number }>(
      `SELECT user_id, last_notified_rank
       FROM leaderboard_snapshots
       WHERE user_id = ANY($1)
         AND scope = 'global'
         AND track = 'main'
         AND last_notified_rank IS NOT NULL`,
      [userIds]
    );
    for (const row of prevRows) {
      previousRankMap.set(row.user_id, row.last_notified_rank);
    }
  } catch (err) {
    errors.push(`previousRankFetch: ${String(err)}`);
  }

  // -------------------------------------------------------------------------
  // Step 3: Batch-upsert ALL snapshots (all users × all 7 tracks) in ONE query
  //
  // Builds parallel arrays: userIds repeated 7×, tracks rotated, xp values.
  // Single INSERT with unnest() replaces the previous loop of 7 serial calls
  // per user (N×7 round-trips → 1 round-trip total).
  // -------------------------------------------------------------------------
  try {
    const trackXpGetter: Record<string, (u: ActiveUserRow) => number> = {
      main:        (u) => u.xp_total,
      social:      (u) => u.xp_social      ?? 0,
      creator:     (u) => u.xp_creator     ?? 0,
      competitor:  (u) => u.xp_competitor  ?? 0,
      generosity:  (u) => u.xp_generosity  ?? 0,
      knowledge:   (u) => u.xp_knowledge   ?? 0,
      explorer:    (u) => u.xp_explorer    ?? 0,
      gaming:      (u) => u.xp_gaming      ?? 0,
    };

    const batchUserIds: string[] = [];
    const batchTracks: string[] = [];
    const batchXps: number[] = [];

    for (const user of activeUsers) {
      for (const track of TRACKS) {
        batchUserIds.push(user.user_id);
        batchTracks.push(track);
        batchXps.push(trackXpGetter[track](user));
      }
    }

    await db.query(
      `INSERT INTO leaderboard_snapshots
         (user_id, track, scope, city, season_id, xp_value, updated_at)
       SELECT
         unnest($1::uuid[]),
         unnest($2::text[]),
         'global',
         NULL,
         NULL,
         unnest($3::int[]),
         NOW()
       ON CONFLICT (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))
       DO UPDATE SET xp_value = EXCLUDED.xp_value, updated_at = NOW()`,
      [batchUserIds, batchTracks, batchXps]
    );

    usersUpdated = activeUsers.length;
  } catch (err) {
    errors.push(`batchUpsertSnapshots: ${String(err)}`);
  }

  // -------------------------------------------------------------------------
  // Step 4: Batch-compute new ranks, then batch-update + batch-notify
  //
  // Single window function query computes RANK() for all active users.
  // One batch UPDATE for last_notified_rank.
  // One batch INSERT for rank-change notifications.
  // -------------------------------------------------------------------------
  try {
    const { rows: rankRows } = await db.query<{ user_id: string; new_rank: number }>(
      `WITH all_ranks AS (
         SELECT user_id,
                RANK() OVER (PARTITION BY scope ORDER BY xp_value DESC)::int AS new_rank
         FROM leaderboard_snapshots
         WHERE scope = 'global' AND track = 'main'
       )
       SELECT user_id, new_rank FROM all_ranks WHERE user_id = ANY($1)`,
      [userIds]
    );

    // Separate into: all ranks to persist, and subset that needs notifications
    const updateUserIds: string[] = [];
    const updateRanks: number[] = [];
    const notifUserIds: string[] = [];
    const notifTypes: string[] = [];
    const notifPrevRanks: number[] = [];
    const notifNewRanks: number[] = [];
    const notifIsPromotion: boolean[] = [];

    for (const { user_id, new_rank: newRank } of rankRows) {
      updateUserIds.push(user_id);
      updateRanks.push(newRank);

      const previousRank = previousRankMap.get(user_id) ?? null;
      if (previousRank !== null && newRank !== previousRank) {
        rankChanges++;
        const enteredTop10 = newRank <= 10 && previousRank > 10;
        const isPromotion = newRank < previousRank;
        const shouldNotify = enteredTop10 || newRank <= 50;
        if (shouldNotify) {
          notifUserIds.push(user_id);
          notifTypes.push(enteredTop10 ? "leaderboard_top10_entry" : isPromotion ? "leaderboard_rank_up" : "leaderboard_rank_down");
          notifPrevRanks.push(previousRank);
          notifNewRanks.push(newRank);
          notifIsPromotion.push(isPromotion);
        }
      }
    }

    // Batch UPDATE last_notified_rank for all active users
    if (updateUserIds.length > 0) {
      await db.query(
        `UPDATE leaderboard_snapshots ls
         SET last_notified_rank = updates.rank
         FROM (SELECT unnest($1::uuid[]) AS uid, unnest($2::int[]) AS rank) updates
         WHERE ls.user_id = updates.uid AND ls.scope = 'global' AND ls.track = 'main'`,
        [updateUserIds, updateRanks]
      ).catch(() => {});
    }

    // Batch INSERT rank-change notifications
    if (notifUserIds.length > 0) {
      await db.query(
        `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
         SELECT sub.uid, sub.ntype,
                CASE
                  WHEN sub.ntype = 'leaderboard_top10_entry' THEN 'You''re in the Top 10!'
                  WHEN sub.ntype = 'leaderboard_rank_up'     THEN 'You''re climbing the leaderboard!'
                  WHEN sub.ntype = 'leaderboard_rank_down'   THEN 'Your leaderboard rank dropped'
                  ELSE 'Your leaderboard rank has changed'
                END,
                CASE
                  WHEN sub.is_promotion THEN
                    'You rose from rank #' || sub.prev_rank || ' to rank #' || sub.new_rank || '. Keep it up!'
                  ELSE
                    'You dropped from rank #' || sub.prev_rank || ' to rank #' || sub.new_rank || '. Stay active to climb back!'
                END,
                jsonb_build_object(
                  'previous_rank',  sub.prev_rank,
                  'new_rank',       sub.new_rank,
                  'track',          'main',
                  'scope',          'global',
                  'entered_top_10', sub.entered_top10
                ),
                false, NOW()
         FROM (SELECT unnest($1::uuid[]) AS uid,
                      unnest($2::text[]) AS ntype,
                      unnest($3::int[])  AS prev_rank,
                      unnest($4::int[])  AS new_rank,
                      unnest($5::bool[]) AS entered_top10,
                      unnest($6::bool[]) AS is_promotion) sub
         ON CONFLICT DO NOTHING`,
        [
          notifUserIds,
          notifTypes,
          notifPrevRanks,
          notifNewRanks,
          notifTypes.map(t => t === "leaderboard_top10_entry"),
          notifIsPromotion,
        ]
      ).catch(() => {});
    }
  } catch (err) {
    errors.push(`rankChangeNotifications: ${String(err)}`);
  }

  return NextResponse.json({
    ok: true,
    usersUpdated,
    rankChanges,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: now.toISOString(),
  });
}
