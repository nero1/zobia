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
import { db } from "@/lib/db";
import { upsertLeaderboardSnapshot } from "@/lib/leaderboards/engine";

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
  rank_name: string;
}

interface PreviousSnapshotRow {
  rank_position: number;
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
  // Step 2 + 3: Upsert snapshots and detect rank changes
  // -------------------------------------------------------------------------
  for (const user of activeUsers) {
    try {
      // Fetch previous snapshot rank before upserting
      const previousSnapshot = await db.query<PreviousSnapshotRow>(
        `SELECT rank_position FROM leaderboard_snapshots
         WHERE user_id = $1
           AND scope = 'global'
           AND track = 'main'
         LIMIT 1`,
        [user.user_id]
      );
      const previousRank = previousSnapshot.rows[0]?.rank_position ?? null;

      // Upsert the snapshot (engine recalculates rank_position via COUNT)
      const snapshot = await upsertLeaderboardSnapshot(db, user.user_id, "global", "main");

      usersUpdated++;

      // Detect rank change
      if (
        previousRank !== null &&
        snapshot.rankPosition !== previousRank
      ) {
        rankChanges++;

        const enteredTop10 = snapshot.rankPosition <= 10 && previousRank > 10;
        const notifType = enteredTop10 ? "leaderboard_top10_entry" : "leaderboard_rank_change";

        // Always notify on top-10 entry; only notify on general rank change
        // when moving in the top 50 (avoids flooding low-rank users).
        const shouldNotify = enteredTop10 || snapshot.rankPosition <= 50;
        if (shouldNotify) {
          await db.query(
            `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
             VALUES ($1, $2, $3, false, NOW())
             ON CONFLICT DO NOTHING`,
            [
              user.user_id,
              notifType,
              JSON.stringify({
                previous_rank: previousRank,
                new_rank: snapshot.rankPosition,
                track: "main",
                scope: "global",
                entered_top_10: enteredTop10,
              }),
            ]
          );
        }
      }
    } catch (err) {
      errors.push(`user ${user.user_id}: ${String(err)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    usersUpdated,
    rankChanges,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: now.toISOString(),
  });
}
