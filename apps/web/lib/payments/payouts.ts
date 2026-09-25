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

import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { initiateTransfer, verifyTransfer } from "@/lib/payments/paystack";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import { raiseAlert } from "@/lib/alerts/dispatch";
import { insertNotification } from "@/lib/notifications/insert";

// ---------------------------------------------------------------------------
// Circuit breaker keys and helpers
// ---------------------------------------------------------------------------

const CIRCUIT_OPEN_KEY = 'circuit:paystack:open';
const CIRCUIT_FAIL_KEY = 'circuit:paystack:failures';
const CIRCUIT_FAIL_THRESHOLD = 3;
const CIRCUIT_OPEN_TTL_SECONDS = 60;
const CIRCUIT_FAIL_WINDOW_SECONDS = 120;

async function assertCircuitClosed(): Promise<void> {
  const isOpen = await redis.get(CIRCUIT_OPEN_KEY);
  if (isOpen) {
    throw new Error('Paystack circuit breaker is OPEN — skipping attempt');
  }
}

async function recordCircuitSuccess(): Promise<void> {
  await redis.del(CIRCUIT_FAIL_KEY);
}

async function recordCircuitFailure(): Promise<void> {
  const failures = await redis.incr(CIRCUIT_FAIL_KEY);
  await redis.expire(CIRCUIT_FAIL_KEY, CIRCUIT_FAIL_WINDOW_SECONDS);
  if (failures >= CIRCUIT_FAIL_THRESHOLD) {
    await redis.set(CIRCUIT_OPEN_KEY, '1', 'EX', CIRCUIT_OPEN_TTL_SECONDS);
    logger.warn(
      { failures },
      '[payouts:circuit] Paystack circuit breaker OPENED after consecutive failures'
    );
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PendingPayoutRow = {
  id: string;
  creator_id: string;
  net_kobo: bigint | null;
  gross_kobo: bigint | null;
  idempotency_key: string;
  provider_reference: string | null;
  retry_count: number;
  bank_account_snapshot: {
    recipient_code: string;
    bank_name: string;
    account_name: string;
    last4: string;
  } | null;
};

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
  const orm = await getDb();

  // ── Phase 1: Process freshly queued pending payouts ──────────────────────
  // Expressed via `sql` (not the query builder): an UPDATE ... WHERE id IN
  // (SELECT ... FOR UPDATE SKIP LOCKED LIMIT n) RETURNING pattern that
  // Drizzle's builder cannot express directly.
  const pendingResult = await orm.execute<PendingPayoutRow>(sql`
    UPDATE creator_payouts
    SET status = 'processing', updated_at = NOW()
    WHERE id IN (
      SELECT id FROM creator_payouts
      WHERE status = 'pending' AND payout_method = 'bank_transfer'
      ORDER BY created_at ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, creator_id, net_kobo, gross_kobo, idempotency_key, provider_reference, retry_count,
              bank_account_snapshot
  `);
  const pendingRows = pendingResult.rows;

  for (const payout of pendingRows) {
    const { success, dlq } = await attemptTransfer(payout, maxRetries, false);
    if (success) {
      result.processed++;
    } else if (dlq) {
      result.dlq++;
    } else {
      result.failed++;
    }
  }

  // ── Phase 2: Retry failed payouts whose retry window has elapsed ─────────
  const retryLimit = Math.max(1, Math.floor(batchSize / 4));
  const retryResult = await orm.execute<PendingPayoutRow>(sql`
    UPDATE creator_payouts
    SET status = 'processing', updated_at = NOW()
    WHERE id IN (
      SELECT id FROM creator_payouts
      WHERE status = 'failed'
        AND payout_method = 'bank_transfer'
        AND next_retry_at IS NOT NULL
        AND next_retry_at <= NOW()
        AND retry_count < ${maxRetries}
      ORDER BY next_retry_at ASC
      LIMIT ${retryLimit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, creator_id, net_kobo, gross_kobo, idempotency_key, provider_reference, retry_count,
              bank_account_snapshot
  `);
  const retryRows = retryResult.rows;

  for (const payout of retryRows) {
    const { success, dlq } = await attemptTransfer(payout, maxRetries, true);
    if (success) {
      result.retried++;
    } else if (dlq) {
      result.dlq++;
    } else {
      result.failed++;
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
): Promise<{ success: boolean; dlq: boolean }> {
  const snapshot = payout.bank_account_snapshot;
  if (!snapshot?.recipient_code) {
    await moveToDeadLetterQueue(
      payout.id,
      payout.creator_id,
      payout.retry_count,
      "No recipient_code in bank_account_snapshot"
    );
    return { success: false, dlq: true };
  }

  try {
    // Use a single stable reference across ALL attempts so the provider can
    // deduplicate and we never double-pay on a network-blip retry (#6).
    const reference = payout.idempotency_key;

    // BUG-073: Check circuit breaker before any Paystack HTTP call.
    await assertCircuitClosed();

    // On retries, verify whether the previous attempt actually succeeded before
    // re-initiating to avoid double-payment on delayed confirmations.
    if (isRetry && payout.provider_reference) {
      try {
        const prior = await verifyTransfer(payout.provider_reference);
        if (prior.status === "success") {
          await recordCircuitSuccess();
          const orm = await getDb();
          await orm
            .update(schema.creatorPayouts)
            .set({ status: "completed", updatedAt: sql`NOW()` })
            .where(eq(schema.creatorPayouts.id, payout.id));
          return { success: true, dlq: false };
        }
      } catch (verifyErr) {
        // verifyTransfer failed (not found or network error) — record the failure
        // and proceed to re-initiate only if the circuit is still closed.
        await recordCircuitFailure();
        const stillOpen = await redis.get(CIRCUIT_OPEN_KEY);
        if (stillOpen) {
          throw new Error('Paystack circuit breaker is OPEN — skipping attempt');
        }
      }
    }

    const transfer = await initiateTransfer(
      Number(payout.net_kobo ?? 0),
      snapshot.recipient_code,
      reference,
      "Creator payout"
    );

    // BUG-073: Successful Paystack call — reset the failure counter.
    await recordCircuitSuccess();

    const orm = await getDb();
    await orm
      .update(schema.creatorPayouts)
      .set({
        providerReference: transfer.transfer_code,
        lastRetryAt: sql`NOW()`,
        nextRetryAt: null,
        updatedAt: sql`NOW()`,
      })
      .where(eq(schema.creatorPayouts.id, payout.id));

    return { success: true, dlq: false };
  } catch (err) {
    // BUG-073: Record failure for circuit breaker unless it's a circuit-open error itself.
    const errMsg = err instanceof Error ? err.message : '';
    if (!errMsg.includes('circuit breaker is OPEN')) {
      await recordCircuitFailure();
    }

    const newRetryCount = payout.retry_count + 1;

    if (newRetryCount >= maxRetries) {
      await moveToDeadLetterQueue(
        payout.id,
        payout.creator_id,
        newRetryCount,
        err instanceof Error ? err.message : "Unknown Paystack error"
      );
      return { success: false, dlq: true };
    }

    // Schedule next retry
    const offsetMinutes = nextRetryOffsetMinutes(newRetryCount - 1);
    const orm = await getDb();
    await orm
      .update(schema.creatorPayouts)
      .set({
        status: "failed",
        retryCount: newRetryCount,
        lastRetryAt: sql`NOW()`,
        nextRetryAt: sql`NOW() + (${String(offsetMinutes)} || ' minutes')::INTERVAL`,
        updatedAt: sql`NOW()`,
      })
      .where(eq(schema.creatorPayouts.id, payout.id));

    return { success: false, dlq: false };
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
  let reconciled = 0;
  let failed = 0;

  // BUG-PY01 FIX: Use CTE with FOR UPDATE SKIP LOCKED so concurrent reconciler
  // invocations cannot both pick up the same stuck payout. The lock is released
  // immediately after the SELECT, before the external API call, to avoid holding
  // it for the duration of the Paystack round-trip.
  const orm = await getDb();
  const candidatesResult = await orm.execute<{ id: string; provider_reference: string }>(sql`
    WITH candidates AS (
      SELECT id, provider_reference
      FROM creator_payouts
      WHERE status = 'processing'
        AND updated_at < NOW() - INTERVAL '30 minutes'
        AND provider_reference IS NOT NULL
      ORDER BY updated_at ASC
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    )
    SELECT id, provider_reference FROM candidates
  `);
  const candidateIds = candidatesResult.rows;

  for (const candidate of candidateIds) {
    try {
      // BUG-073: Check circuit breaker before Paystack HTTP call.
      await assertCircuitClosed();

      // Verify with external provider before touching the DB
      const transfer = await verifyTransfer(candidate.provider_reference);

      // Successful call — reset failure counter.
      await recordCircuitSuccess();

      if (transfer.status === "success") {
        // Wrap in transaction with FOR UPDATE so concurrent webhook handlers
        // cannot race with this reconciliation step.
        await orm.transaction(async (tx) => {
          const cur = await tx
            .select({
              status: schema.creatorPayouts.status,
              creatorId: schema.creatorPayouts.creatorId,
              netKobo: schema.creatorPayouts.netKobo,
              grossKobo: schema.creatorPayouts.grossKobo,
            })
            .from(schema.creatorPayouts)
            .where(eq(schema.creatorPayouts.id, candidate.id))
            .for("update", { skipLocked: true });
          if (!cur[0] || cur[0].status === "completed") return; // already handled
          await tx
            .update(schema.creatorPayouts)
            .set({ status: "completed", updatedAt: sql`NOW()` })
            .where(eq(schema.creatorPayouts.id, candidate.id));
        });
        reconciled++;
      } else if (transfer.status === "failed" || transfer.status === "reversed") {
        // Restore creator earnings idempotently (guard with earnings_restored flag)
        await orm.transaction(async (tx) => {
          const cur = await tx
            .select({
              status: schema.creatorPayouts.status,
              earningsRestored: schema.creatorPayouts.earningsRestored,
              creatorId: schema.creatorPayouts.creatorId,
              netKobo: schema.creatorPayouts.netKobo,
              grossKobo: schema.creatorPayouts.grossKobo,
            })
            .from(schema.creatorPayouts)
            .where(eq(schema.creatorPayouts.id, candidate.id))
            .for("update", { skipLocked: true });
          if (!cur[0] || cur[0].status === "failed") return; // already handled
          await tx
            .update(schema.creatorPayouts)
            .set({ status: "failed", updatedAt: sql`NOW()` })
            .where(eq(schema.creatorPayouts.id, candidate.id));
          if (!cur[0].earningsRestored) {
            if (cur[0].netKobo == null) {
              throw new Error(`[payouts] Cannot restore payout ${candidate.id}: net_kobo is null. Manual ops review required.`);
            }
            const restoreAmount = cur[0].netKobo;
            await tx
              .update(schema.creatorPayouts)
              .set({ earningsRestored: true })
              .where(eq(schema.creatorPayouts.id, candidate.id));
            await tx
              .update(schema.users)
              .set({
                availableEarningsKobo: sql`COALESCE(${schema.users.availableEarningsKobo}, 0) + ${restoreAmount}`,
                updatedAt: sql`NOW()`,
              })
              .where(eq(schema.users.id, cur[0].creatorId));
          }
        });
        failed++;
      }
      // For other statuses (pending, otp, abandoned) — leave as 'processing'
      // and let the next reconciliation cycle pick them up again.
    } catch (err) {
      // BUG-073: Record circuit failure unless it's a circuit-open short-circuit.
      const errMsg = err instanceof Error ? err.message : '';
      if (!errMsg.includes('circuit breaker is OPEN')) {
        await recordCircuitFailure();
      }
      logger.error({ err: err }, `[payouts:reconcile] Failed to reconcile payout ${candidate.id}:`);
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
  const orm = await getDb();
  let nullNetKobo: { grossKobo: bigint | null } | null = null;

  await orm.transaction(async (tx) => {
    // Lock the payout row so concurrent callers (cron + webhook) don't both restore earnings (#7)
    const current = await tx
      .select({
        netKobo: schema.creatorPayouts.netKobo,
        grossKobo: schema.creatorPayouts.grossKobo,
        earningsRestored: schema.creatorPayouts.earningsRestored,
        status: schema.creatorPayouts.status,
      })
      .from(schema.creatorPayouts)
      .where(eq(schema.creatorPayouts.id, payoutId))
      .for("update");
    if (!current[0]) return;

    // Mark payout as permanently failed
    await tx
      .update(schema.creatorPayouts)
      .set({ status: "failed", retryCount, nextRetryAt: null, updatedAt: sql`NOW()` })
      .where(eq(schema.creatorPayouts.id, payoutId));

    // Restore creator's earnings only once using net_kobo (the actual amount sent to creator).
    // earnings_restored guards against double-credit when both the DLQ cron and the
    // transfer.failed webhook fire.
    if (!current[0].earningsRestored) {
      const restoreAmount = current[0].netKobo;
      if (restoreAmount == null) {
        logger.error({ payoutId, creatorId }, "[payout/dlq] net_kobo is null — cannot restore earnings safely; requires manual review");
        // raiseAlert (lib/alerts/dispatch.ts, out of scope for this migration)
        // still expects the legacy adapter type, so it cannot participate in
        // this Drizzle transaction directly — recorded here and fired with
        // the raw adapter right after the transaction settles (best-effort,
        // same as before).
        nullNetKobo = { grossKobo: current[0].grossKobo };
      } else {
        await tx
          .update(schema.creatorPayouts)
          .set({ earningsRestored: true })
          .where(eq(schema.creatorPayouts.id, payoutId));
        await tx
          .update(schema.users)
          .set({
            availableEarningsKobo: sql`${schema.users.availableEarningsKobo} + ${restoreAmount}`,
            updatedAt: sql`NOW()`,
          })
          .where(eq(schema.users.id, creatorId));
      }
    }

    // Insert dead-letter record (ON CONFLICT to tolerate duplicate calls)
    await tx
      .insert(schema.payoutDeadLetterQueue)
      .values({
        payoutId,
        creatorId,
        failureReason: reason,
        retryCount,
        lastAttemptedAt: sql`NOW()`,
      })
      .onConflictDoNothing({ target: schema.payoutDeadLetterQueue.payoutId });
  });

  // Type assertion needed because TS narrows the `let` var (assigned inside
  // the async transaction callback) to `null` after the await; the runtime
  // value is correct.
  const capturedNullNetKobo = nullNetKobo as { grossKobo: bigint | null } | null;
  if (capturedNullNetKobo) {
    await raiseAlert(await getDb(), {
      type: "payout_dlq_null_net_kobo",
      category: "financial",
      priorityLevel: 2,
      title: "Payout stuck — earnings not restored",
      message: `Payout ${payoutId} moved to DLQ but net_kobo is null — earnings not restored`,
      metadata: { payoutId, creatorId, grossKobo: capturedNullNetKobo.grossKobo },
      dedupeKey: `payout_dlq_null:${payoutId}`,
    }).catch(() => {});
  }

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
    insertNotification(
      await getDb(),
      creatorId,
      "payout_failed",
      "Payout Failed",
      "Your payout could not be processed after multiple attempts. Your earnings have been restored to your balance.",
      { payoutId, reason }
    ).catch(() => {}),

    // System alert for admin
    raiseAlert(await getDb(), {
      type: "payout_failed",
      category: "financial",
      priorityLevel: 2,
      title: "Payout moved to dead-letter queue",
      message: `Payout ${payoutId} for creator ${creatorId} moved to dead-letter queue after max retries. Reason: ${reason}`,
      metadata: { payoutId, creatorId, reason },
      dedupeKey: `payout_failed:${payoutId}`,
    }).catch(() => {}),
  ]);
}
