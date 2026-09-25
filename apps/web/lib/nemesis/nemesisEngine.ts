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

import { and, eq, sql, type SQL } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { getManifestValue } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum XP deviation (fraction) when finding a nemesis. */
const NEMESIS_XP_TOLERANCE = 0.10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withConcurrency<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency: number
): Promise<void> {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    chunks.push(items.slice(i, i + concurrency));
  }
  for (const chunk of chunks) {
    await Promise.allSettled(chunk.map(fn));
  }
}

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
  nemesis_opt_out: boolean;
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
 * @param db     - Drizzle db instance or an active transaction handle.
 * @returns The nemesis_assignments row created, or null if no candidate found.
 */
export async function assignNemesis(
  userId: string,
  db: DbOrTx
): Promise<NemesisAssignment | null> {
  // NOTE: `nemesis_opt_out` is not modelled in lib/db/schema.ts's `users`
  // table (a genuine schema/DB mismatch — flagged in the migration report),
  // so it is referenced via raw `sql` fragments rather than a typed column.
  const userResult = await db.execute<UserRow & Record<string, unknown>>(sql`
    SELECT id, xp_total, city, COALESCE(nemesis_opt_out, false) AS nemesis_opt_out
    FROM users WHERE id = ${userId} AND deleted_at IS NULL
  `);
  const user = (userResult.rows as UserRow[])[0];
  if (!user) return null;
  // Users who opted out (Profile Settings) never get a nemesis assigned.
  if (user.nemesis_opt_out) return null;

  const xpTotal = Number(user.xp_total);
  const minXP = Math.floor(xpTotal * (1 - NEMESIS_XP_TOLERANCE));
  const maxXP = Math.ceil(xpTotal * (1 + NEMESIS_XP_TOLERANCE));

  // Mutual friends (bidirectional friendship using the friendships table)
  const friendRowsA = await db
    .select({ friendId: schema.friendships.addresseeId })
    .from(schema.friendships)
    .where(sql`${schema.friendships.requesterId} = ${userId} AND ${schema.friendships.status} = 'accepted'`);
  const friendRowsB = await db
    .select({ friendId: schema.friendships.requesterId })
    .from(schema.friendships)
    .where(sql`${schema.friendships.addresseeId} = ${userId} AND ${schema.friendships.status} = 'accepted'`);
  const mutualFriendIds = new Set([...friendRowsA, ...friendRowsB].map((r) => r.friendId));

  // Current nemesis (to avoid re-assigning immediately after dismiss) — BUG-11: use is_active
  const [currentNemesisRow] = await db
    .select({ nemesisId: schema.nemesisAssignments.nemesisUserId })
    .from(schema.nemesisAssignments)
    .where(sql`${schema.nemesisAssignments.userId} = ${userId} AND ${schema.nemesisAssignments.isActive} = true`)
    .orderBy(sql`${schema.nemesisAssignments.assignedAt} DESC`)
    .limit(1);
  const currentNemesisId = currentNemesisRow?.nemesisId;

  // Try same-city first, then any city
  for (const useCityFilter of [true, false]) {
    const conditions: SQL[] = [
      sql`u.id != ${userId}`,
      sql`u.deleted_at IS NULL`,
      sql`COALESCE(u.nemesis_opt_out, false) = false`,
      sql`u.xp_total BETWEEN ${minXP} AND ${maxXP}`,
      // Exclude users in any block relationship with the target (mutual-block safety)
      sql`u.id NOT IN (
         SELECT blocked_id FROM user_blocks WHERE blocker_id = ${userId}
         UNION
         SELECT blocker_id FROM user_blocks WHERE blocked_id = ${userId}
       )`,
    ];

    if (useCityFilter && user.city) {
      conditions.push(sql`u.city = ${user.city}`);
    }

    const candidateResult = await db.execute<{ id: string }>(sql`
      SELECT u.id FROM users u
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY ABS(u.xp_total - ${xpTotal}) ASC
      LIMIT 50
    `);

    const candidates = (candidateResult.rows as { id: string }[]).filter(
      (r) => !mutualFriendIds.has(r.id) && r.id !== currentNemesisId
    );

    if (candidates.length === 0) continue;

    const chosenId = candidates[0].id;

    // expires_at = 7 days from now (weekly refresh cycle)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Wrap deactivation + insert atomically — if the insert fails, the old
    // nemesis must not be deactivated (guards against inconsistent state).
    const orm = await getDb();
    const insertResult = await orm.transaction(async (tx) => {
      await tx
        .update(schema.nemesisAssignments)
        .set({ isActive: false })
        .where(and(eq(schema.nemesisAssignments.userId, userId), eq(schema.nemesisAssignments.isActive, true)));

      return tx
        .insert(schema.nemesisAssignments)
        .values({
          userId,
          nemesisUserId: chosenId,
          expiresAt,
          isActive: true,
        })
        .returning({
          userId: schema.nemesisAssignments.userId,
          nemesisId: schema.nemesisAssignments.nemesisUserId,
          assignedAt: schema.nemesisAssignments.assignedAt,
        });
    });

    const inserted = insertResult[0];
    return inserted
      ? {
          user_id: inserted.userId,
          nemesis_id: inserted.nemesisId,
          assigned_at: inserted.assignedAt ? new Date(inserted.assignedAt).toISOString() : new Date().toISOString(),
          dismissed_at: null,
        }
      : null;
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
 * @param db - Drizzle db instance or an active transaction handle.
 */
export async function refreshNemesisAssignments(
  db: DbOrTx
): Promise<{ updated: number; failed: number }> {
  // BUG: deactivate assignments for users who opted out (Profile Settings)
  // since their last refresh — assignNemesis() alone won't touch an existing
  // row for them, it just declines to create a new one.
  await db
    .execute(sql`
      UPDATE nemesis_assignments SET is_active = false
      WHERE is_active = true
        AND user_id IN (SELECT id FROM users WHERE nemesis_opt_out = true)
    `)
    .catch(() => {});

  const usersResult = await db
    .selectDistinct({ userId: schema.nemesisAssignments.userId })
    .from(schema.nemesisAssignments)
    .where(eq(schema.nemesisAssignments.isActive, true));

  let updated = 0;
  let failed = 0;

  const userIds1 = usersResult.map((r) => r.userId);
  await withConcurrency(userIds1, async (user_id) => {
    try {
      const result = await assignNemesis(user_id, db);
      if (result) updated++;
    } catch {
      failed++;
    }
  }, 10);

  // Also assign nemeses to active users who don't have one — BUG-11: filter by is_active, not dismissed_at
  const unassignedResult = await db.execute<{ id: string }>(sql`
    SELECT u.id FROM users u
    WHERE u.deleted_at IS NULL
      AND u.xp_total > 0
      AND COALESCE(u.nemesis_opt_out, false) = false
      AND u.id NOT IN (
        SELECT user_id FROM nemesis_assignments WHERE is_active = true
      )
    LIMIT 1000
  `);

  const userIds2 = (unassignedResult.rows as { id: string }[]).map((r) => r.id);
  await withConcurrency(userIds2, async (id) => {
    try {
      const result = await assignNemesis(id, db);
      if (result) updated++;
    } catch {
      failed++;
    }
  }, 10);

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
 * @param db        - Drizzle db instance or an active transaction handle.
 * @returns Comparison result with XP values and who is currently ahead.
 */
export async function compareNemesisProgress(
  userId: string,
  nemesisId: string,
  track: string,
  db: DbOrTx
): Promise<{
  userXP: number;
  nemesisXP: number;
  delta: number;
  userIsAhead: boolean;
}> {
  type XPRow = { user_id: string; xp_value: number };

  const trackColumnMap: Record<string, string> = {
    main: "xp_total",
    social: "xp_social",
    creator: "xp_creator",
    competitor: "xp_competitor",
    generosity: "xp_generosity",
    knowledge: "xp_knowledge",
    explorer: "xp_explorer",
    gaming: "xp_gaming",
  };
  const col = trackColumnMap[track];
  if (!col || !new Set(Object.values(trackColumnMap)).has(col)) {
    throw new Error(`compareNemesisProgress: unknown XP track '${track}'`);
  }

  const result = await db.execute<XPRow>(
    sql`SELECT id AS user_id, ${sql.raw(col)} AS xp_value FROM users WHERE id = ANY(ARRAY[${userId}::uuid, ${nemesisId}::uuid])`
  );
  const rows = result.rows as XPRow[];

  const userRow = rows.find((r) => r.user_id === userId);
  const nemesisRow = rows.find((r) => r.user_id === nemesisId);

  const userXP = Number(userRow?.xp_value ?? 0);
  const nemesisXP = Number(nemesisRow?.xp_value ?? 0);

  return {
    userXP,
    nemesisXP,
    delta: userXP - nemesisXP,
    userIsAhead: userXP >= nemesisXP,
  };
}

// ---------------------------------------------------------------------------
// expireUnacceptedNemesisChallenges
// ---------------------------------------------------------------------------

/** Fallback if the `nemesis_challenge_accept_days` manifest key is missing. */
const DEFAULT_CHALLENGE_ACCEPT_DAYS = 3;

/**
 * CRON: sweeps XP-sprint challenges the challenged party never accepted.
 *
 * If a challenge sent by `x` to their nemesis `y` sits unaccepted for more
 * than the admin-configured `nemesis_challenge_accept_days` window (default
 * 3), the challenge is marked 'expired' and `x` is given a new nemesis
 * assignment — the current one has gone quiet, so keep the rivalry active
 * rather than leaving `x` stuck challenging someone who never responds.
 *
 * Intended to run once a day (any pending challenge older than the window
 * qualifies, independent of the weekly nemesis-refresh cadence).
 *
 * @param db - Drizzle db instance or an active transaction handle.
 */
export async function expireUnacceptedNemesisChallenges(
  db: DbOrTx
): Promise<{ expired: number; reassigned: number; failed: number }> {
  const acceptDaysRaw = await getManifestValue("nemesis_challenge_accept_days");
  const acceptDays = Math.max(1, parseInt(acceptDaysRaw ?? "", 10) || DEFAULT_CHALLENGE_ACCEPT_DAYS);

  const staleResult = await db.execute<{ id: string; challenger_id: string }>(sql`
    SELECT id, challenger_id FROM nemesis_challenges
    WHERE status = 'pending'
      AND created_at < NOW() - (${acceptDays} || ' days')::interval
  `);
  const staleChallenges = staleResult.rows as { id: string; challenger_id: string }[];

  if (staleChallenges.length === 0) return { expired: 0, reassigned: 0, failed: 0 };

  let reassigned = 0;
  let failed = 0;

  await withConcurrency(staleChallenges, async (challenge) => {
    try {
      await db
        .update(schema.nemesisChallenges)
        .set({ status: "expired" })
        .where(and(eq(schema.nemesisChallenges.id, challenge.id), eq(schema.nemesisChallenges.status, "pending")));

      const newAssignment = await assignNemesis(challenge.challenger_id, db);
      if (newAssignment) {
        reassigned++;
        await db
          .insert(schema.notifications)
          .values({
            userId: challenge.challenger_id,
            type: "nemesis_challenge_expired",
            payload: { newNemesisId: newAssignment.nemesis_id },
            isRead: false,
          })
          .catch(() => {});
      }
    } catch {
      failed++;
    }
  }, 10);

  return { expired: staleChallenges.length, reassigned, failed };
}
