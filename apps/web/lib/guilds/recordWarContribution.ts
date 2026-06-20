/**
 * lib/guilds/recordWarContribution.ts
 *
 * Records war point contributions when guild members perform activities during active wars.
 * Called as a best-effort operation (via .catch()) from activity endpoints.
 * No error thrown — silently logs failures to maintain request latency.
 *
 * Flow:
 *  1. Find if the user is in an active/final_hour guild war
 *  2. Calculate war points based on activity type (doubled in Final Hour)
 *  3. Upsert into war_contributions table (accumulates points per user per war)
 *  4. Update the guild's total war points on the war row (challenger_points or defender_points)
 */

import { calculateWarPoints, type WarActivity } from './warEngine';
import type { DatabaseAdapter } from '@/lib/db/interface';

/**
 * Record a war point contribution for a user during an active guild war.
 * Safe to call multiple times per request (UPSERT is idempotent).
 * Does not throw; errors are logged for debugging.
 *
 * @param userId - The user who performed the activity
 * @param activity - The activity type (send_message, send_gift, etc.)
 * @param db - Database adapter
 */
export async function recordWarContribution(
  userId: string,
  activity: WarActivity,
  db: DatabaseAdapter
): Promise<void> {
  try {
    // The status check and the contribution writes must happen inside the same
    // transaction. Without this, a concurrent resolveWar call can resolve the war
    // between the status SELECT and the contribution INSERT (TOCTOU race).
    await db.transaction(async (tx) => {
      // Find the user's active guild war (no FOR UPDATE here — the subsequent
      // UPDATE on guild_wars takes an implicit row lock, which is sufficient).
      const { rows } = await tx.query<{
        war_id: string;
        guild_id: string;
        status: 'active' | 'final_hour';
        is_challenger: boolean;
      }>(
        `SELECT gw.id AS war_id,
                gm.guild_id,
                gw.status,
                (gw.challenger_guild_id = gm.guild_id) AS is_challenger
         FROM guild_members gm
         JOIN guild_wars gw
           ON (gw.challenger_guild_id = gm.guild_id OR gw.defender_guild_id = gm.guild_id)
         WHERE gm.user_id = $1
           AND gm.left_at IS NULL
           AND gw.status IN ('active', 'final_hour')
           AND gw.starts_at <= NOW()
           AND gw.ends_at > NOW()
         LIMIT 1`,
        [userId]
      );

      // User is not in any active war; nothing to record
      if (rows.length === 0) return;

      const { war_id, guild_id, status, is_challenger } = rows[0];

      // Calculate war points for this activity (doubled in Final Hour)
      const pts = calculateWarPoints(activity, status === 'final_hour');

      await tx.query(
        `INSERT INTO war_contributions (war_id, user_id, guild_id, war_points, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (war_id, user_id)
         DO UPDATE SET war_points = war_contributions.war_points + EXCLUDED.war_points, updated_at = NOW()`,
        [war_id, userId, guild_id, pts]
      );

      // Re-check war status in the UPDATE WHERE clause: if resolveWar just completed
      // the war, the UPDATE matches 0 rows and we silently skip rather than writing
      // stale points. The ON CONFLICT upsert above already ran but its effect is
      // inconsequential because resolveWar has already summed final contribution totals.
      if (is_challenger) {
        await tx.query(
          `UPDATE guild_wars SET challenger_points = challenger_points + $1, updated_at = NOW()
           WHERE id = $2 AND status IN ('active', 'final_hour')`,
          [pts, war_id]
        );
      } else {
        await tx.query(
          `UPDATE guild_wars SET defender_points = defender_points + $1, updated_at = NOW()
           WHERE id = $2 AND status IN ('active', 'final_hour')`,
          [pts, war_id]
        );
      }
    });
  } catch (err) {
    // Best-effort: log but do not throw
    // Prevents war contribution failures from breaking message sends, etc.
    console.error('[recordWarContribution]', err);
  }
}
