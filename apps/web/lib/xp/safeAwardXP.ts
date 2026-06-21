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
import { upsertLeaderboardSnapshot } from "@/lib/leaderboards/engine";
import type { LeaderboardTrack } from "@/lib/leaderboards/engine";

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
  | "explorer"
  | "gaming";

const TRACK_COLUMN: Record<XPTrack, string> = {
  main: "xp_total",
  social: "xp_social",
  creator: "xp_creator",
  competitor: "xp_competitor",
  generosity: "xp_generosity",
  knowledge: "xp_knowledge",
  explorer: "xp_explorer",
  gaming: "xp_gaming",
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
 * @param referenceId - Idempotency key (prevents double-award on retry).
 *                      ALWAYS provide this. Callers passing null disable retry
 *                      deduplication — the DLQ partial-index only fires when
 *                      reference_id IS NOT NULL, so null-referenceId awards
 *                      can double-award on CRON retry.
 * @param dbClient    - Optional transaction client; falls back to global db.
 *                      IMPORTANT: Only call this function AFTER the caller's
 *                      outer transaction has committed. If the caller's
 *                      transaction rolls back, the DLQ entry created here
 *                      (via globalDb) will describe XP that was never actually
 *                      lost — the CRON retry will attempt to re-award XP that
 *                      is already correctly absent. The reference_id guard on
 *                      the ledger INSERT prevents actual double-awards for
 *                      non-null referenceIds, but phantom DLQ entries may
 *                      appear and consume retry slots unnecessarily.
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

    const trackSelectExpr = col === "xp_total" ? "" : `, ${col}`;

    // BUG-01: single CTE — UPDATE only fires when INSERT actually inserts a row
    // BUG-02: RETURNING xp_total (and track column) so we can update leaderboard_snapshots
    const { rows } = await (client as DatabaseAdapter).query<{ id: string; xp_total: number; city: string | null } & Record<string, unknown>>(
      `WITH ins AS (
         INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, base_amount, created_at)
         VALUES ($1, $2, $3, $4, $5, $2, NOW())
         ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
         RETURNING id
       )
       UPDATE users
         SET xp_total = xp_total + $2,
             ${col === "xp_total" ? "" : `${col} = COALESCE(${col}, 0) + $2,`}
             updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM ins)
       RETURNING id, xp_total, city${trackSelectExpr}`,
      [userId, amount, track, source, referenceId ?? null]
    );

    // BUG-02: update leaderboard snapshot whenever XP is awarded.
    // BUG-LB-01: also upsert city-scoped snapshot when the user has a city set.
    // Use `client` (not globalDb) so the snapshot update participates in the
    // caller's transaction and is rolled back together if the transaction fails.
    if (rows[0]) {
      const xpTotal = Number(rows[0].xp_total);
      const trackXP = col === "xp_total" ? xpTotal : Number(rows[0][col]);
      const city = rows[0].city ?? null;
      // BUG-M01: Log snapshot failures instead of silently swallowing them.
      await upsertLeaderboardSnapshot(userId, "main", xpTotal, client).catch((err) => {
        logger.warn({ err, userId, track: "main" }, "[leaderboard] snapshot upsert failed after XP award");
      });
      if (track !== "main") {
        await upsertLeaderboardSnapshot(userId, track as LeaderboardTrack, trackXP, client).catch((err) => {
          logger.warn({ err, userId, track }, "[leaderboard] snapshot upsert failed after XP award");
        });
      }
      // City-scoped snapshots
      if (city) {
        await upsertLeaderboardSnapshot(userId, "main", xpTotal, client, { scope: "city", city }).catch((err) => {
          logger.warn({ err, userId, city, track: "main" }, "[leaderboard] city snapshot upsert failed after XP award");
        });
        if (track !== "main") {
          await upsertLeaderboardSnapshot(userId, track as LeaderboardTrack, trackXP, client, { scope: "city", city }).catch((err) => {
            logger.warn({ err, userId, city, track }, "[leaderboard] city snapshot upsert failed after XP award");
          });
        }
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ userId, amount, track, source }, `[safeAwardXP] Failed to award ${amount} XP (${track}/${source}) to ${userId}: ${errorMessage}`);

    // DLQ-01: Only write to the DLQ when NOT inside a caller's transaction.
    // If dbClient is a TransactionClient (caller-provided tx), the outer
    // transaction may still roll back — writing DLQ here would create a phantom
    // entry describing XP that was never actually lost.
    // Callers that provide a transaction client are responsible for error handling.
    if (!dbClient) {
      await globalDb.query(
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

      const SAFE_XP_COLS_RETRY = new Set(Object.values(TRACK_COLUMN));
      if (!SAFE_XP_COLS_RETRY.has(col)) throw new Error(`[retryFailedXPAwards] Unsafe XP track column: ${col}`);

      // Use a synthetic reference_id for rows that have NULL to enable ON CONFLICT dedup.
      // Rows with NULL reference_id use a deterministic key so concurrent retries can't
      // double-award (partial-index ON CONFLICT only fires when reference_id IS NOT NULL).
      const effectiveRef = row.reference_id ?? `dlq_retry:${row.user_id}:${row.source}:${row.id}`;

      // Wrap both the XP ledger INSERT and the resolved_at UPDATE in a single transaction
      // so a partial failure can't leave the award applied but the DLQ row unresolved.
      let retryXpTotal: number | null = null;
      let retryTrackXP: number | null = null;
      let retryCity: string | null = null;
      const retryTrackSelectExpr = col === "xp_total" ? "" : `, ${col}`;

      await globalDb.transaction(async (tx) => {
        const { rows: retryRows } = await tx.query<{ xp_total: number; city: string | null } & Record<string, unknown>>(
          `WITH ins AS (
             INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, base_amount, created_at)
             VALUES ($1, $2, $3, $4, $5, $2, NOW())
             ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
             RETURNING id
           )
           UPDATE users
             SET xp_total = xp_total + $2,
                 ${col === "xp_total" ? "" : `${col} = COALESCE(${col}, 0) + $2,`}
                 updated_at = NOW()
           WHERE id = $1 AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM ins)
           RETURNING xp_total, city${retryTrackSelectExpr}`,
          [row.user_id, row.amount, row.track, row.source, effectiveRef]
        );

        if (retryRows[0]) {
          retryXpTotal = Number(retryRows[0].xp_total);
          retryTrackXP = col === "xp_total" ? retryXpTotal : Number(retryRows[0][col]);
          retryCity = retryRows[0].city ?? null;
        }

        await tx.query(
          `UPDATE failed_xp_awards SET resolved_at = NOW() WHERE id = $1`,
          [row.id]
        );
      });

      // BUG-02: update leaderboard snapshot after successful retry.
      // BUG-LB-01: also upsert city-scoped snapshot when user has a city.
      if (retryXpTotal !== null) {
        await upsertLeaderboardSnapshot(row.user_id, "main", retryXpTotal, globalDb).catch((err) => {
          logger.warn({ err, userId: row.user_id, track: "main" }, "[leaderboard] snapshot upsert failed after DLQ retry");
        });
        if (row.track !== "main" && retryTrackXP !== null) {
          await upsertLeaderboardSnapshot(row.user_id, row.track as LeaderboardTrack, retryTrackXP, globalDb).catch((err) => {
            logger.warn({ err, userId: row.user_id, track: row.track }, "[leaderboard] snapshot upsert failed after DLQ retry");
          });
        }
        if (retryCity) {
          await upsertLeaderboardSnapshot(row.user_id, "main", retryXpTotal, globalDb, { scope: "city", city: retryCity }).catch((err) => {
            logger.warn({ err, userId: row.user_id, city: retryCity, track: "main" }, "[leaderboard] city snapshot upsert failed after DLQ retry");
          });
          if (row.track !== "main" && retryTrackXP !== null) {
            await upsertLeaderboardSnapshot(row.user_id, row.track as LeaderboardTrack, retryTrackXP, globalDb, { scope: "city", city: retryCity }).catch((err) => {
              logger.warn({ err, userId: row.user_id, city: retryCity, track: row.track }, "[leaderboard] city snapshot upsert failed after DLQ retry");
            });
          }
        }
      }

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
