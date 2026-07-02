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
 *
 * @throws When `dbClient` is provided (caller-supplied transaction) and the XP
 *         award fails. The DLQ write is intentionally skipped in this case because
 *         the outer transaction may still roll back — a DLQ entry created before
 *         commit describes XP that was never lost and would cause spurious retries.
 *         Callers that pass `dbClient` MUST either:
 *         (a) catch the thrown error and write their own DLQ record via globalDb
 *             AFTER the transaction commits, or
 *         (b) use `safeAwardXPFireAndForget` for best-effort awards that should
 *             never block or roll back their surrounding transaction.
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

      // Daily Quest System 'xp_meta' meta-quest ("Earn N XP today") — dynamic
      // import avoids a circular dependency (questEngine imports safeAwardXP).
      // Excludes quest/deck reward sources so a quest's own payout doesn't
      // recursively feed the meta-quest that likely just completed it.
      // Only fires when no caller transaction is in flight (`!dbClient`) —
      // the XP row is durably committed at this point, and
      // triggerActivityQuestProgress opens its own transaction internally,
      // which a TransactionClient (unlike the full DatabaseAdapter) cannot do.
      const XP_META_EXCLUDED_SOURCES = new Set([
        "quest_complete",
        "deck_completion",
        "deck_bonus",
        "mentorship_bonus",
      ]);
      if (amount > 0 && !dbClient && !XP_META_EXCLUDED_SOURCES.has(source)) {
        import("@/lib/quests/questEngine")
          .then(({ triggerActivityQuestProgress }) =>
            triggerActivityQuestProgress(userId, "xp_meta", globalDb, amount)
          )
          .catch((err) => {
            logger.warn({ err, userId, source }, "[safeAwardXP] xp_meta quest trigger failed (non-fatal)");
          });
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
    } else {
      // Rethrow when caller provided a transaction client so the outer transaction
      // can roll back cleanly and the caller knows the award failed.
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Fire-and-forget wrapper
// ---------------------------------------------------------------------------

/**
 * BUG-026 FIX: Award XP in a true fire-and-forget manner.
 *
 * Calls `safeAwardXP` without a `dbClient` (so DLQ is always available on
 * failure) and suppresses the returned Promise — the caller never awaits it and
 * the XP award never blocks or throws into the caller's execution context.
 *
 * Use this when XP is a secondary side-effect of an already-committed action
 * (e.g. post-transaction reward in a serverless handler). Do NOT use inside a
 * database transaction — call it AFTER `tx.commit()` / the transaction block.
 *
 * @param userId      - User UUID
 * @param amount      - XP amount (positive integer)
 * @param track       - Which XP track to credit
 * @param source      - Source event name
 * @param referenceId - Idempotency key — provide this to enable DLQ dedup
 */
export function safeAwardXPFireAndForget(
  userId: string,
  amount: number,
  track: XPTrack,
  source: string,
  referenceId?: string | null
): void {
  safeAwardXP(userId, amount, track, source, referenceId).catch((err) => {
    logger.error(
      { userId, amount, track, source },
      `[safeAwardXPFireAndForget] Unexpected error (DLQ write already attempted): ${err}`
    );
  });
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

  // Fetch eligible rows INSIDE a transaction with FOR UPDATE SKIP LOCKED so that
  // concurrent CRON instances each lock their own exclusive batch and cannot
  // retry the same rows simultaneously (which would prematurely exhaust retry_count).
  // BUG-RACE-02 FIX: the SELECT … FOR UPDATE SKIP LOCKED must execute inside a
  // wrapping transaction; without BEGIN/COMMIT the row-level lock is released
  // immediately after the query completes, defeating the SKIP LOCKED intent.
  let rows: Array<{
    id: string;
    user_id: string;
    amount: number;
    track: XPTrack;
    source: string;
    reference_id: string | null;
    retry_count: number;
  }> = [];

  await globalDb.transaction(async (lockTx) => {
    const result = await lockTx.query<{
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
       LIMIT 100
       FOR UPDATE SKIP LOCKED`,
      [MAX_RETRIES]
    );
    rows = result.rows;

    // Process each row inside the same transaction that holds the lock so the
    // lock is held for the full batch-processing duration.
    for (const row of rows) {
    try {
      const col = TRACK_COLUMN[row.track] ?? "xp_total";

      const SAFE_XP_COLS_RETRY = new Set(Object.values(TRACK_COLUMN));
      if (!SAFE_XP_COLS_RETRY.has(col)) throw new Error(`[retryFailedXPAwards] Unsafe XP track column: ${col}`);

      // Use a synthetic reference_id for rows that have NULL to enable ON CONFLICT dedup.
      // Rows with NULL reference_id use a deterministic key so concurrent retries can't
      // double-award (partial-index ON CONFLICT only fires when reference_id IS NOT NULL).
      const effectiveRef = row.reference_id ?? `dlq_retry:${row.user_id}:${row.source}:${row.id}`;

      // Use lockTx directly for both the XP award and the resolved_at mark.
      // Opening a nested globalDb.transaction() here would acquire a second pool
      // connection while lockTx already holds one — deadlocking when pool size ≤ 2.
      // lockTx's transaction already provides the atomicity we need.
      let retryXpTotal: number | null = null;
      let retryTrackXP: number | null = null;
      let retryCity: string | null = null;
      const retryTrackSelectExpr = col === "xp_total" ? "" : `, ${col}`;

      const { rows: retryRows } = await lockTx.query<{ xp_total: number; city: string | null } & Record<string, unknown>>(
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

      await lockTx.query(
        `UPDATE failed_xp_awards SET resolved_at = NOW() WHERE id = $1`,
        [row.id]
      );

      // BUG-02: update leaderboard snapshot after successful retry.
      // BUG-LB-01: also upsert city-scoped snapshot when user has a city.
      // BUG-017 FIX: use lockTx (not globalDb) so snapshot upserts participate in
      // the same transaction that holds the FOR UPDATE SKIP LOCKED row locks.
      // Using globalDb here would auto-commit the snapshot outside the lock
      // transaction, causing the snapshot to be visible before the DLQ row is
      // marked resolved (and potentially racing with concurrent CRON instances).
      if (retryXpTotal !== null) {
        await upsertLeaderboardSnapshot(row.user_id, "main", retryXpTotal, lockTx).catch((err) => {
          logger.warn({ err, userId: row.user_id, track: "main" }, "[leaderboard] snapshot upsert failed after DLQ retry");
        });
        if (row.track !== "main" && retryTrackXP !== null) {
          await upsertLeaderboardSnapshot(row.user_id, row.track as LeaderboardTrack, retryTrackXP, lockTx).catch((err) => {
            logger.warn({ err, userId: row.user_id, track: row.track }, "[leaderboard] snapshot upsert failed after DLQ retry");
          });
        }
        if (retryCity) {
          await upsertLeaderboardSnapshot(row.user_id, "main", retryXpTotal, lockTx, { scope: "city", city: retryCity }).catch((err) => {
            logger.warn({ err, userId: row.user_id, city: retryCity, track: "main" }, "[leaderboard] city snapshot upsert failed after DLQ retry");
          });
          if (row.track !== "main" && retryTrackXP !== null) {
            await upsertLeaderboardSnapshot(row.user_id, row.track as LeaderboardTrack, retryTrackXP, lockTx, { scope: "city", city: retryCity }).catch((err) => {
              logger.warn({ err, userId: row.user_id, city: retryCity, track: row.track }, "[leaderboard] city snapshot upsert failed after DLQ retry");
            });
          }
        }
      }

      resolved++;
    } catch (err) {
      const newRetryCount = row.retry_count + 1;
      // Use lockTx so the retry_count update is part of the same transaction
      // that holds the FOR UPDATE SKIP LOCKED lock.
      await lockTx.query(
        `UPDATE failed_xp_awards
         SET retry_count = $1, last_retried_at = NOW(),
             error_message = $2
         WHERE id = $3`,
        [newRetryCount, err instanceof Error ? err.message : String(err), row.id]
      );

      if (newRetryCount >= MAX_RETRIES) {
        permanentlyFailed++;
        await globalDb.query(
          `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
           VALUES ('xp_award_permanent_failure', 'warning', $1, $2::jsonb, NOW())`,
          [
            `XP award permanently failed after ${MAX_RETRIES} retries for user ${row.user_id}`,
            JSON.stringify({ failedXpAwardId: row.id, userId: row.user_id, source: row.source }),
          ]
        ).catch(() => {});
      }
    }  // end catch
    }  // end for (const row of rows)
  });  // end globalDb.transaction

  return { resolved, permanentlyFailed };
}
