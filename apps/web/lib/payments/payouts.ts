/**
 * lib/payments/payouts.ts
 *
 * Batch payout processor — used by the /api/cron/payouts CRON handler.
 *
 * Responsibilities:
 *   - Process pending bank_transfer payouts in batches via Paystack
 *   - Retry failed payouts with exponential back-off
 *   - Move permanently-failed payouts to payout_dead_letter_queue
 *   - Notify creators and admin on failure
 *
 * Retry schedule (next_retry_at offsets from last_retry_at):
 *   Attempt 1 → +5 minutes
 *   Attempt 2 → +15 minutes
 *   Attempt 3 → +45 minutes
 *   After 3 attempts → dead-letter queue + failure notifications
 */

import { db } from "@/lib/db";
import { initiateTransfer } from "@/lib/payments/paystack";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingPayoutRow {
  id: string;
  creator_id: string;
  net_kobo: number;
  gross_kobo: number;
  idempotency_key: string;
  retry_count: number;
  bank_account_snapshot: {
    recipient_code: string;
    bank_name: string;
    account_name: string;
    last4: string;
  } | null;
}

export interface BatchResult {
  processed: number;
  retried: number;
  failed: number;
  dlq: number;
}

// ---------------------------------------------------------------------------
// Retry delay schedule
// ---------------------------------------------------------------------------

const RETRY_DELAYS_MINUTES = [5, 15, 45] as const;

function nextRetryOffsetMinutes(retryCount: number): number {
  return RETRY_DELAYS_MINUTES[retryCount] ?? 60;
}

// ---------------------------------------------------------------------------
// Main batch processor
// ---------------------------------------------------------------------------

/**
 * Process up to batchSize pending bank_transfer payouts via Paystack.
 * Also retries failed payouts whose next_retry_at is due.
 */
export async function processPendingPayouts(
  batchSize: number,
  maxRetries: number
): Promise<BatchResult> {
  const result: BatchResult = { processed: 0, retried: 0, failed: 0, dlq: 0 };

  // ── Phase 1: Process freshly queued pending payouts ──────────────────────
  const { rows: pendingRows } = await db.query<PendingPayoutRow>(
    `SELECT id, creator_id, net_kobo, gross_kobo, idempotency_key, retry_count,
            bank_account_snapshot
     FROM creator_payouts
     WHERE status = 'pending' AND payout_method = 'bank_transfer'
     ORDER BY created_at ASC
     LIMIT $1`,
    [batchSize]
  );

  for (const payout of pendingRows) {
    const success = await attemptTransfer(payout, maxRetries, false);
    if (success) {
      result.processed++;
    } else {
      const movedToDlq = payout.retry_count + 1 >= maxRetries;
      if (movedToDlq) result.dlq++;
      else result.failed++;
    }
  }

  // ── Phase 2: Retry failed payouts whose retry window has elapsed ─────────
  const { rows: retryRows } = await db.query<PendingPayoutRow>(
    `SELECT id, creator_id, net_kobo, gross_kobo, idempotency_key, retry_count,
            bank_account_snapshot
     FROM creator_payouts
     WHERE status = 'failed'
       AND payout_method = 'bank_transfer'
       AND next_retry_at IS NOT NULL
       AND next_retry_at <= NOW()
       AND retry_count < $1
     ORDER BY next_retry_at ASC
     LIMIT $2`,
    [maxRetries, Math.max(1, Math.floor(batchSize / 4))]
  );

  for (const payout of retryRows) {
    const success = await attemptTransfer(payout, maxRetries, true);
    if (success) {
      result.retried++;
    } else {
      const movedToDlq = payout.retry_count + 1 >= maxRetries;
      if (movedToDlq) result.dlq++;
      else result.failed++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Single transfer attempt
// ---------------------------------------------------------------------------

async function attemptTransfer(
  payout: PendingPayoutRow,
  maxRetries: number,
  isRetry: boolean
): Promise<boolean> {
  const snapshot = payout.bank_account_snapshot;
  if (!snapshot?.recipient_code) {
    await moveToDeadLetterQueue(
      payout.id,
      payout.creator_id,
      payout.retry_count,
      "No recipient_code in bank_account_snapshot"
    );
    return false;
  }

  try {
    const reference = isRetry
      ? `${payout.idempotency_key}:retry${payout.retry_count + 1}`
      : `${payout.idempotency_key}:auto`;

    const transfer = await initiateTransfer(
      payout.net_kobo,
      snapshot.recipient_code,
      reference,
      "Creator payout"
    );

    await db.query(
      `UPDATE creator_payouts
       SET status = 'processing',
           provider_reference = $1,
           last_retry_at = NOW(),
           next_retry_at = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [transfer.transfer_code, payout.id]
    );

    return true;
  } catch (err) {
    const newRetryCount = payout.retry_count + 1;

    if (newRetryCount >= maxRetries) {
      await moveToDeadLetterQueue(
        payout.id,
        payout.creator_id,
        newRetryCount,
        err instanceof Error ? err.message : "Unknown Paystack error"
      );
      return false;
    }

    // Schedule next retry
    const offsetMinutes = nextRetryOffsetMinutes(newRetryCount - 1);
    await db.query(
      `UPDATE creator_payouts
       SET status = 'failed',
           retry_count = $1,
           last_retry_at = NOW(),
           next_retry_at = NOW() + ($2 || ' minutes')::INTERVAL,
           updated_at = NOW()
       WHERE id = $3`,
      [newRetryCount, String(offsetMinutes), payout.id]
    );

    return false;
  }
}

// ---------------------------------------------------------------------------
// Dead-letter queue
// ---------------------------------------------------------------------------

export async function moveToDeadLetterQueue(
  payoutId: string,
  creatorId: string,
  retryCount: number,
  reason: string
): Promise<void> {
  await db.transaction(async (tx) => {
    // Mark payout as permanently failed
    await tx.query(
      `UPDATE creator_payouts
       SET status = 'failed',
           retry_count = $1,
           next_retry_at = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [retryCount, payoutId]
    );

    // Restore creator's earnings
    const { rows } = await tx.query<{ gross_kobo: number }>(
      `SELECT gross_kobo FROM creator_payouts WHERE id = $1`,
      [payoutId]
    );
    if (rows[0]) {
      await tx.query(
        `UPDATE users
         SET available_earnings_kobo = available_earnings_kobo + $1, updated_at = NOW()
         WHERE id = $2`,
        [rows[0].gross_kobo, creatorId]
      );
    }

    // Insert dead-letter record
    await tx.query(
      `INSERT INTO payout_dead_letter_queue
         (payout_id, creator_id, failure_reason, retry_count, last_attempted_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [payoutId, creatorId, reason, retryCount]
    );
  });

  // Notifications — best-effort, non-blocking
  await notifyPayoutFailure(payoutId, creatorId, reason).catch(() => {});
}

// ---------------------------------------------------------------------------
// Failure notifications
// ---------------------------------------------------------------------------

export async function notifyPayoutFailure(
  payoutId: string,
  creatorId: string,
  reason: string
): Promise<void> {
  await Promise.all([
    // In-app notification to creator
    db
      .query(
        `INSERT INTO notifications
           (user_id, type, title, body, metadata, created_at)
         VALUES ($1, 'payout_failed', 'Payout Failed',
           'Your payout could not be processed after multiple attempts. Your earnings have been restored to your balance.',
           $2::jsonb, NOW())`,
        [creatorId, JSON.stringify({ payoutId, reason })]
      )
      .catch(() => {}),

    // System alert for admin
    db
      .query(
        `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
         VALUES ('payout_failed', 'critical', $1, $2::jsonb, NOW())`,
        [
          `Payout ${payoutId} for creator ${creatorId} moved to dead-letter queue after max retries. Reason: ${reason}`,
          JSON.stringify({ payoutId, creatorId, reason }),
        ]
      )
      .catch(() => {}),
  ]);
}
