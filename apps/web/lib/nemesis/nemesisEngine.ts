/**
 * lib/nemesis/nemesisEngine.ts
 *
 * Nemesis assignment engine.
 *
 * A "nemesis" is a rival user assigned based on proximity in XP.
 * Design rules:
 *  - XP within ±10% of the target user
 *  - Same city preferred (city-matched candidates tried first)
 *  - NEVER a mutual friend of the target user
 *  - Refreshed weekly (every Sunday by CRON)
 *  - A user cannot be their own nemesis
 */

import type { DatabaseAdapter } from "@/lib/db/interface";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum XP deviation (fraction) when finding a nemesis. */
const NEMESIS_XP_TOLERANCE = 0.10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NemesisAssignment {
  user_id: string;
  nemesis_id: string;
  assigned_at: string;
  dismissed_at: string | null;
}

interface UserRow {
  id: string;
  xp_total: number;
  city: string | null;
}

// ---------------------------------------------------------------------------
// assignNemesis
// ---------------------------------------------------------------------------

/**
 * Finds and assigns a nemesis for a user.
 *
 * Candidate selection criteria (in priority order):
 *  1. XP within ±10% of the user's total XP
 *  2. Not a mutual friend
 *  3. Not the user themselves
 *  4. Not already the user's current active nemesis
 *  5. Same city preferred (tried first)
 *
 * @param userId - UUID of the user needing a nemesis assignment.
 * @param db     - Active database adapter.
 * @returns The nemesis_assignments row created, or null if no candidate found.
 */
export async function assignNemesis(
  userId: string,
  db: DatabaseAdapter
): Promise<NemesisAssignment | null> {
  const userResult = await db.query<UserRow>(
    `SELECT id, xp_total, city FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  const user = userResult.rows[0];
  if (!user) return null;

  const minXP = Math.floor(user.xp_total * (1 - NEMESIS_XP_TOLERANCE));
  const maxXP = Math.ceil(user.xp_total * (1 + NEMESIS_XP_TOLERANCE));

  // Mutual friends (bidirectional friendship using the friendships table)
  const friendResult = await db.query<{ friend_id: string }>(
    `SELECT addressee_id AS friend_id
     FROM friendships
     WHERE requester_id = $1 AND status = 'accepted'
     UNION
     SELECT requester_id AS friend_id
     FROM friendships
     WHERE addressee_id = $1 AND status = 'accepted'`,
    [userId]
  );
  const mutualFriendIds = new Set(friendResult.rows.map((r) => r.friend_id));

  // Current nemesis (to avoid re-assigning immediately after dismiss)
  const currentNemesisResult = await db.query<{ nemesis_id: string }>(
    `SELECT nemesis_id FROM nemesis_assignments
     WHERE user_id = $1 AND dismissed_at IS NULL
     ORDER BY assigned_at DESC LIMIT 1`,
    [userId]
  );
  const currentNemesisId = currentNemesisResult.rows[0]?.nemesis_id;

  // Try same-city first, then any city
  for (const useCityFilter of [true, false]) {
    const conditions = [
      `u.id != $1`,
      `u.deleted_at IS NULL`,
      `u.xp_total BETWEEN $2 AND $3`,
    ];
    const params: (string | number)[] = [userId, minXP, maxXP];
    let paramIdx = 4;

    if (useCityFilter && user.city) {
      conditions.push(`u.city = $${paramIdx++}`);
      params.push(user.city);
    }

    const candidateResult = await db.query<{ id: string }>(
      `SELECT u.id FROM users u
       WHERE ${conditions.join(" AND ")}
       ORDER BY ABS(u.xp_total - $${paramIdx}) ASC
       LIMIT 50`,
      [...params, user.xp_total]
    );

    const candidates = candidateResult.rows.filter(
      (r) => !mutualFriendIds.has(r.id) && r.id !== currentNemesisId
    );

    if (candidates.length === 0) continue;

    const chosenId = candidates[0].id;

    // Dismiss any existing nemesis assignment (set is_active=false)
    await db.query(
      `UPDATE nemesis_assignments SET is_active = false
       WHERE user_id = $1 AND is_active = true`,
      [userId]
    );

    // expires_at = 7 days from now (weekly refresh cycle)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Insert new assignment using schema-correct column names
    const insertResult = await db.query<NemesisAssignment>(
      `INSERT INTO nemesis_assignments (user_id, nemesis_user_id, assigned_at, expires_at, is_active)
       VALUES ($1, $2, NOW(), $3, true)
       RETURNING user_id, nemesis_user_id AS nemesis_id, assigned_at, NULL::timestamptz AS dismissed_at`,
      [userId, chosenId, expiresAt]
    );

    return insertResult.rows[0] ?? null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// refreshNemesisAssignments
// ---------------------------------------------------------------------------

/**
 * CRON job: Weekly refresh of all active nemesis assignments.
 *
 * Iterates over all users who have an active (non-dismissed) nemesis and
 * re-runs the assignment algorithm. Users whose current nemesis is still
 * a valid match may receive a different opponent.
 *
 * Intended to be called on Sundays by the daily CRON handler.
 *
 * @param db - Active database adapter.
 */
export async function refreshNemesisAssignments(
  db: DatabaseAdapter
): Promise<{ updated: number; failed: number }> {
  const usersResult = await db.query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM nemesis_assignments WHERE is_active = true`,
    []
  );

  let updated = 0;
  let failed = 0;

  for (const { user_id } of usersResult.rows) {
    try {
      const result = await assignNemesis(user_id, db);
      if (result) updated++;
    } catch {
      failed++;
    }
  }

  // Also assign nemeses to active users who don't have one
  const unassignedResult = await db.query<{ id: string }>(
    `SELECT u.id FROM users u
     WHERE u.deleted_at IS NULL
       AND u.xp_total > 0
       AND u.id NOT IN (
         SELECT user_id FROM nemesis_assignments WHERE dismissed_at IS NULL
       )
     LIMIT 1000`,
    []
  );

  for (const { id } of unassignedResult.rows) {
    try {
      const result = await assignNemesis(id, db);
      if (result) updated++;
    } catch {
      failed++;
    }
  }

  return { updated, failed };
}

// ---------------------------------------------------------------------------
// compareNemesisProgress
// ---------------------------------------------------------------------------

/**
 * Compares XP progress between a user and their nemesis on a specific track.
 *
 * @param userId    - UUID of the requesting user.
 * @param nemesisId - UUID of the nemesis to compare against.
 * @param track     - Which XP track to compare ('main' | 'social' | 'creator' | etc.)
 * @param db        - Active database adapter.
 * @returns Comparison result with XP values and who is currently ahead.
 */
export async function compareNemesisProgress(
  userId: string,
  nemesisId: string,
  track: string,
  db: DatabaseAdapter
): Promise<{
  userXP: number;
  nemesisXP: number;
  delta: number;
  userIsAhead: boolean;
}> {
  type XPRow = { user_id: string; xp_value: number };

  let query: string;
  let params: string[];

  const trackColumnMap: Record<string, string> = {
    main: "xp_total",
    social: "xp_social",
    creator: "xp_creator",
    competitor: "xp_competitor",
    generosity: "xp_generosity",
    knowledge: "xp_knowledge",
    explorer: "xp_explorer",
  };
  const col = trackColumnMap[track] ?? "xp_total";
  query = `SELECT id AS user_id, ${col} AS xp_value FROM users WHERE id = ANY($1::uuid[])`;
  params = [`{${userId},${nemesisId}}`];

  const result = await db.query<XPRow>(query, params);

  const userRow = result.rows.find((r) => r.user_id === userId);
  const nemesisRow = result.rows.find((r) => r.user_id === nemesisId);

  const userXP = userRow?.xp_value ?? 0;
  const nemesisXP = nemesisRow?.xp_value ?? 0;

  return {
    userXP,
    nemesisXP,
    delta: userXP - nemesisXP,
    userIsAhead: userXP >= nemesisXP,
  };
}
