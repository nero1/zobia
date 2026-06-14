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
import { initiateTransfer, verifyTransfer } from "@/lib/payments/paystack";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingPayoutRow {
  id: string;
  creator_id: string;
  net_kobo: number;
  gross_kobo: number;
  idempotency_key: string;
  provider_reference: string | null;
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

/**
 * Returns the platform fee rate for a creator tier.
 * Icon creators pay 15% (earn 85%), all others pay 20% (earn 80%).
 */
export function getCreatorFeeRate(creatorTier: string | null | undefined): number {
  return creatorTier === 'icon' ? 0.15 : 0.20;
}

// ---------------------------------------------------------------------------
// Retry delay schedule
// ---------------------------------------------------------------------------

const RETRY_DELAYS_MINUTES = [5, 15, 45] as const;

function nextRetryOffsetMinutes(retryCount: number): number {
  const base = RETRY_DELAYS_MINUTES[retryCount] ?? 60;
  const jitter = (Math.random() - 0.5) * base * 0.4;
  return Math.max(1, Math.round(base + jitter));
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
    `UPDATE creator_payouts
     SET status = 'processing', updated_at = NOW()
     WHERE id IN (
       SELECT id FROM creator_payouts
       WHERE status = 'pending' AND payout_method = 'bank_transfer'
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, creator_id, net_kobo, gross_kobo, idempotency_key, provider_reference, retry_count,
               bank_account_snapshot`,
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
    `UPDATE creator_payouts
     SET status = 'processing', updated_at = NOW()
     WHERE id IN (
       SELECT id FROM creator_payouts
       WHERE status = 'failed'
         AND payout_method = 'bank_transfer'
         AND next_retry_at IS NOT NULL
         AND next_retry_at <= NOW()
         AND retry_count < $1
       ORDER BY next_retry_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, creator_id, net_kobo, gross_kobo, idempotency_key, provider_reference, retry_count,
               bank_account_snapshot`,
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
    // Use a single stable reference across ALL attempts so the provider can
    // deduplicate and we never double-pay on a network-blip retry (#6).
    const reference = payout.idempotency_key;

    // On retries, verify whether the previous attempt actually succeeded before
    // re-initiating to avoid double-payment on delayed confirmations.
    if (isRetry && payout.provider_reference) {
      try {
        const prior = await verifyTransfer(payout.provider_reference);
        if (prior.status === "success") {
          await db.query(
            `UPDATE creator_payouts SET status = 'completed', updated_at = NOW() WHERE id = $1`,
            [payout.id]
          );
          return true;
        }
      } catch {
        // verifyTransfer failed (not found or network error) — proceed to re-initiate
      }
    }

    const transfer = await initiateTransfer(
      payout.net_kobo,
      snapshot.recipient_code,
      reference,
      "Creator payout"
    );

    await db.query(
      `UPDATE creator_payouts
       SET provider_reference = $1,
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
// Reconciliation — fix payouts stuck in 'processing'
// ---------------------------------------------------------------------------

/**
 * Reconcile payouts stuck in 'processing' for more than 30 minutes.
 *
 * A payout can get stuck if the Paystack webhook is lost or delayed. This
 * function re-queries the provider for each stuck payout's current status and
 * updates the local record accordingly, restoring the creator's earnings on
 * failure so funds are never permanently stuck.
 *
 * Runs at most 50 stuck payouts per invocation to bound execution time.
 *
 * @returns Counts of reconciled (completed) and failed payouts
 */
export async function reconcileStuckPayouts(): Promise<{ reconciled: number; failed: number }> {
  // Find payouts stuck in 'processing' for more than 30 minutes
  const { rows: stuckPayouts } = await db.query<{
    id: string;
    provider_reference: string;
    creator_id: string;
    gross_kobo: string;
  }>(
    `WITH candidates AS (
       SELECT id, provider_reference, creator_id, gross_kobo
       FROM creator_payouts
       WHERE status = 'processing'
         AND updated_at < NOW() - INTERVAL '30 minutes'
         AND provider_reference IS NOT NULL
       ORDER BY updated_at ASC
       LIMIT 50
       FOR UPDATE SKIP LOCKED
     )
     SELECT * FROM candidates`
  );

  let reconciled = 0;
  let failed = 0;

  for (const payout of stuckPayouts) {
    try {
      const transfer = await verifyTransfer(payout.provider_reference);

      if (transfer.status === "success") {
        await db.query(
          `UPDATE creator_payouts SET status = 'completed', updated_at = NOW() WHERE id = $1`,
          [payout.id]
        );
        reconciled++;
      } else if (transfer.status === "failed" || transfer.status === "reversed") {
        // Restore creator earnings idempotently (guard with earnings_restored flag)
        await db.transaction(async (tx) => {
          const { rows: cur } = await tx.query<{ earnings_restored: boolean }>(
            `SELECT earnings_restored FROM creator_payouts WHERE id = $1 FOR UPDATE`,
            [payout.id]
          );
          await tx.query(
            `UPDATE creator_payouts SET status = 'failed', updated_at = NOW() WHERE id = $1`,
            [payout.id]
          );
          if (cur[0] && !cur[0].earnings_restored) {
            await tx.query(
              `UPDATE creator_payouts SET earnings_restored = true WHERE id = $1`,
              [payout.id]
            );
            await tx.query(
              `UPDATE users
               SET available_earnings_kobo = COALESCE(available_earnings_kobo, 0) + $1,
                   updated_at = NOW()
               WHERE id = $2`,
              [payout.gross_kobo, payout.creator_id]
            );
          }
        });
        failed++;
      }
      // For other statuses (pending, otp, abandoned) — leave as 'processing'
      // and let the next reconciliation cycle pick them up again.
    } catch (err) {
      console.error(`[payouts:reconcile] Failed to reconcile payout ${payout.id}:`, err);
    }
  }

  return { reconciled, failed };
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
    // Lock the payout row so concurrent callers (cron + webhook) don't both restore earnings (#7)
    const { rows: current } = await tx.query<{ gross_kobo: number; earnings_restored: boolean; status: string }>(
      `SELECT gross_kobo, earnings_restored, status FROM creator_payouts WHERE id = $1 FOR UPDATE`,
      [payoutId]
    );
    if (!current[0]) return;

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

    // Restore creator's earnings only once. earnings_restored guards against
    // double-credit when both the DLQ cron and the transfer.failed webhook fire.
    if (!current[0].earnings_restored) {
      await tx.query(
        `UPDATE creator_payouts SET earnings_restored = true WHERE id = $1`,
        [payoutId]
      );
      await tx.query(
        `UPDATE users
         SET available_earnings_kobo = available_earnings_kobo + $1, updated_at = NOW()
         WHERE id = $2`,
        [current[0].gross_kobo, creatorId]
      );
    }

    // Insert dead-letter record (ON CONFLICT to tolerate duplicate calls)
    await tx.query(
      `INSERT INTO payout_dead_letter_queue
         (payout_id, creator_id, failure_reason, retry_count, last_attempted_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (payout_id) DO NOTHING`,
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
