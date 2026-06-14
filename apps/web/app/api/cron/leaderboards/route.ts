export const dynamic = 'force-dynamic';

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
 *  2. Upsert a leaderboard_snapshot for each active user.
 *  3. Detect rank changes since the previous snapshot.
 *  4. Insert leaderboard_ripple notifications for users whose rank changed.
 *
 * Returns { usersUpdated, rankChanges }
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { upsertLeaderboardSnapshot } from "@/lib/leaderboards/engine";

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
// Constants
// ---------------------------------------------------------------------------

/** Look-back window for "recently active" XP ledger entries. */
const ACTIVE_WINDOW_MINUTES = 15;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActiveUserRow {
  user_id: string;
  xp_total: number;
  xp_social: number;
  xp_creator: number;
  xp_competitor: number;
  xp_generosity: number;
  xp_knowledge: number;
  xp_explorer: number;
  rank_name: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * 15-minute leaderboard CRON.
 * Protected by CRON_SECRET Bearer token.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const windowStart = new Date(
    now.getTime() - ACTIVE_WINDOW_MINUTES * 60 * 1000
  );

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
    return NextResponse.json(
      { ok: false, errors, timestamp: now.toISOString() },
      { status: 500 }
    );
  }

  // -------------------------------------------------------------------------
  // Step 2: Batch-fetch previous snapshot ranks before any upserts
  // -------------------------------------------------------------------------
  const userIds = activeUsers.map((u) => u.user_id);
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
  // Step 3: Upsert all snapshots
  // -------------------------------------------------------------------------
  for (const user of activeUsers) {
    try {
      await Promise.all([
        upsertLeaderboardSnapshot(user.user_id, "main", user.xp_total, db),
        upsertLeaderboardSnapshot(user.user_id, "social", user.xp_social ?? 0, db),
        upsertLeaderboardSnapshot(user.user_id, "creator", user.xp_creator ?? 0, db),
        upsertLeaderboardSnapshot(user.user_id, "competitor", user.xp_competitor ?? 0, db),
        upsertLeaderboardSnapshot(user.user_id, "generosity", user.xp_generosity ?? 0, db),
        upsertLeaderboardSnapshot(user.user_id, "knowledge", user.xp_knowledge ?? 0, db),
        upsertLeaderboardSnapshot(user.user_id, "explorer", user.xp_explorer ?? 0, db),
      ]);
      usersUpdated++;
    } catch (err) {
      errors.push(`upsertSnapshot(${user.user_id}): ${String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Batch-compute new ranks with a single window function query,
  //         then dispatch rank-change notifications
  // -------------------------------------------------------------------------
  try {
    // Compute RANK() over the full leaderboard snapshot table (not just active
    // users) so that the absolute rank position is correct.  Then filter to the
    // active-user subset for notification dispatch.
    const { rows: rankRows } = await db.query<{ user_id: string; new_rank: number }>(
      `WITH all_ranks AS (
         SELECT user_id,
                RANK() OVER (PARTITION BY scope ORDER BY xp_value DESC)::int AS new_rank
         FROM leaderboard_snapshots
         WHERE scope = 'global' AND track = 'main'
       )
       SELECT user_id, new_rank
       FROM all_ranks
       WHERE user_id = ANY($1)`,
      [userIds]
    );

    for (const { user_id, new_rank: newRank } of rankRows) {
      const previousRank = previousRankMap.get(user_id) ?? null;

      // Always persist the new rank so future runs have a baseline
      await db.query(
        `UPDATE leaderboard_snapshots
         SET last_notified_rank = $1
         WHERE user_id = $2 AND scope = 'global' AND track = 'main'`,
        [newRank, user_id]
      ).catch(() => {});

      if (previousRank !== null && newRank !== previousRank) {
        rankChanges++;

        const enteredTop10 = newRank <= 10 && previousRank > 10;
        const notifType = enteredTop10 ? "leaderboard_top10_entry" : "leaderboard_rank_change";
        const shouldNotify = enteredTop10 || newRank <= 50;

        if (shouldNotify) {
          await db.query(
            `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
             VALUES ($1, $2, $3, false, NOW())
             ON CONFLICT DO NOTHING`,
            [
              user_id,
              notifType,
              JSON.stringify({
                previous_rank: previousRank,
                new_rank: newRank,
                track: "main",
                scope: "global",
                entered_top_10: enteredTop10,
              }),
            ]
          );
        }
      }
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
