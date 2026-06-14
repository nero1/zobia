/**
 * lib/xp/safeAwardXP.ts
 *
 * SYS-01: XP dead-letter queue for failed fire-and-forget awards.
 *
 * Wraps the common XP ledger INSERT + users UPDATE pattern. On failure,
 * writes to `failed_xp_awards` instead of silently swallowing the error.
 * A nightly CRON step retries rows with retry_count < 5.
 */

import type { DatabaseAdapter, TransactionClient } from "@/lib/db/interface";
import { db as globalDb } from "@/lib/db";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type XPTrack =
  | "main"
  | "social"
  | "creator"
  | "competitor"
  | "generosity"
  | "knowledge"
  | "explorer";

const TRACK_COLUMN: Record<XPTrack, string> = {
  main: "xp_total",
  social: "xp_social",
  creator: "xp_creator",
  competitor: "xp_competitor",
  generosity: "xp_generosity",
  knowledge: "xp_knowledge",
  explorer: "xp_explorer",
};

// ---------------------------------------------------------------------------
// Core helper
// ---------------------------------------------------------------------------

/**
 * Award XP to a user safely. On failure, records the award in
 * `failed_xp_awards` for later retry instead of silently dropping it.
 *
 * @param userId      - User UUID
 * @param amount      - XP amount (positive integer)
 * @param track       - Which XP track to credit
 * @param source      - Source event name (e.g. 'send_gift_message')
 * @param referenceId - Optional idempotency key (prevents double-award on retry)
 * @param dbClient    - Optional transaction client; falls back to global db
 */
export async function safeAwardXP(
  userId: string,
  amount: number,
  track: XPTrack,
  source: string,
  referenceId?: string | null,
  dbClient?: DatabaseAdapter | TransactionClient
): Promise<void> {
  const client = dbClient ?? globalDb;

  try {
    const col = TRACK_COLUMN[track];

    // BUG-38: runtime allowlist guard before interpolating col into SQL
    const SAFE_XP_COLS = new Set(Object.values(TRACK_COLUMN));
    if (!SAFE_XP_COLS.has(col)) throw new Error(`[safeAwardXP] Unsafe XP track column: ${col}`);

    // BUG-01: single CTE — UPDATE only fires when INSERT actually inserts a row
    await (client as DatabaseAdapter).query(
      `WITH ins AS (
         INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, base_amount, created_at)
         VALUES ($1, $2, $3, $4, $5, $2, NOW())
         ON CONFLICT DO NOTHING
         RETURNING id
       )
       UPDATE users
         SET xp_total = xp_total + $2,
             ${col === "xp_total" ? "" : `${col} = COALESCE(${col}, 0) + $2,`}
             updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM ins)`,
      [userId, amount, track, source, referenceId ?? null]
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ userId, amount, track, source }, `[safeAwardXP] Failed to award ${amount} XP (${track}/${source}) to ${userId}: ${errorMessage}`);

    // Write to DLQ (fire-and-forget with the global db — the passed client may be closed)
    globalDb.query(
      `INSERT INTO failed_xp_awards
         (user_id, amount, track, source, reference_id, error_message, failed_at, retry_count)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 0)
       ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
      [userId, amount, track, source, referenceId ?? null, errorMessage]
    ).catch((dlqErr) => {
      logger.error({ userId, source }, `[safeAwardXP] Failed to write to DLQ: ${dlqErr}`);
    });
  }
}

// ---------------------------------------------------------------------------
// Retry step (called from daily CRON)
// ---------------------------------------------------------------------------

/**
 * Retry failed XP awards from `failed_xp_awards`.
 * Awards with retry_count >= 5 are marked as permanently failed and a
 * system_alert is raised.
 *
 * @returns Count of resolved and permanently failed awards
 */
export async function retryFailedXPAwards(): Promise<{
  resolved: number;
  permanentlyFailed: number;
}> {
  const MAX_RETRIES = 5;
  let resolved = 0;
  let permanentlyFailed = 0;

  // Fetch eligible rows (exponential backoff: 2^retry_count minutes)
  const { rows } = await globalDb.query<{
    id: string;
    user_id: string;
    amount: number;
    track: XPTrack;
    source: string;
    reference_id: string | null;
    retry_count: number;
  }>(
    `SELECT id, user_id, amount, track, source, reference_id, retry_count
     FROM failed_xp_awards
     WHERE resolved_at IS NULL
       AND retry_count < $1
       AND (last_retried_at IS NULL
            OR last_retried_at < NOW() - (POWER(2, retry_count) * INTERVAL '1 minute'))
     LIMIT 100`,
    [MAX_RETRIES]
  );

  for (const row of rows) {
    try {
      const col = TRACK_COLUMN[row.track] ?? "xp_total";

      // BUG-02: same CTE fix as safeAwardXP — UPDATE only fires when INSERT inserts
      const SAFE_XP_COLS_RETRY = new Set(Object.values(TRACK_COLUMN));
      if (!SAFE_XP_COLS_RETRY.has(col)) throw new Error(`[retryFailedXPAwards] Unsafe XP track column: ${col}`);
      await globalDb.query(
        `WITH ins AS (
           INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, base_amount, created_at)
           VALUES ($1, $2, $3, $4, $5, $2, NOW())
           ON CONFLICT DO NOTHING
           RETURNING id
         )
         UPDATE users
           SET xp_total = xp_total + $2,
               ${col === "xp_total" ? "" : `${col} = COALESCE(${col}, 0) + $2,`}
               updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM ins)`,
        [row.user_id, row.amount, row.track, row.source, row.reference_id]
      );

      await globalDb.query(
        `UPDATE failed_xp_awards SET resolved_at = NOW() WHERE id = $1`,
        [row.id]
      );
      resolved++;
    } catch (err) {
      const newRetryCount = row.retry_count + 1;
      await globalDb.query(
        `UPDATE failed_xp_awards
         SET retry_count = $1, last_retried_at = NOW(),
             error_message = $2
         WHERE id = $3`,
        [newRetryCount, err instanceof Error ? err.message : String(err), row.id]
      );

      if (newRetryCount >= MAX_RETRIES) {
        permanentlyFailed++;
        globalDb.query(
          `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
           VALUES ('xp_award_permanent_failure', 'warning', $1, $2::jsonb, NOW())`,
          [
            `XP award permanently failed after ${MAX_RETRIES} retries for user ${row.user_id}`,
            JSON.stringify({ failedXpAwardId: row.id, userId: row.user_id, source: row.source }),
          ]
        ).catch(() => {});
      }
    }
  }

  return { resolved, permanentlyFailed };
}
