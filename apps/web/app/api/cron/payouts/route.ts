export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/payouts
 *
 * External CRON handler for batch payout processing.
 *
 * Triggered every 30 minutes by cron-jobs.org (or equivalent external scheduler).
 * Must NOT be triggered by Vercel's built-in cron (Hobby Plan limit: once daily).
 *
 * IMPORTANT — Setup required:
 *   Add a cron-jobs.org job:
 *     URL:    POST https://<your-domain>/api/cron/payouts
 *     Header: Authorization: Bearer <CRON_SECRET>
 *     Every:  30 minutes
 *
 * What this CRON does:
 *   Phase 1 — Process pending bank_transfer payouts (status='pending'):
 *     Sends up to `payout_batch_size` transfers to Paystack in order of creation.
 *   Phase 2 — Retry failed payouts whose next_retry_at has elapsed:
 *     Re-attempts up to batchSize/4 failed payouts.
 *
 * On permanent failure (retry_count >= payout_max_retries):
 *   - Moves payout to payout_dead_letter_queue
 *   - Restores creator's available_earnings_kobo
 *   - Sends in-app notification to creator + system_alert for admin
 *
 * Auth: Bearer token matching CRON_SECRET environment variable.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadManifest } from "@/lib/manifest";
import { processPendingPayouts, reconcileStuckPayouts } from "@/lib/payments/payouts";
import { validateCronSecret } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db";

export const POST = async (req: NextRequest) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const manifest = await loadManifest();

    if (!manifest.payouts.enabled) {
      return NextResponse.json({
        skipped: true,
        reason: "Payouts are disabled in manifest",
        timestamp: new Date().toISOString(),
      });
    }

    const batchSize = manifest.payouts.batchSize;
    const maxRetries = manifest.payouts.maxRetries;

    const result = await processPendingPayouts(batchSize, maxRetries);

    // Phase 3 — Reconcile payouts stuck in 'processing' for >30 minutes.
    // Re-queries Paystack for their current status to recover from lost webhooks.
    const reconcileResult = await reconcileStuckPayouts();

    // BUG-061: Monitor DLQ depth and alert when it exceeds a threshold.
    let dlqDepth = 0;
    try {
      const { rows } = await db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM payout_dead_letter_queue`
      );
      dlqDepth = parseInt(rows[0]?.count ?? "0", 10);
      const DLQ_ALERT_THRESHOLD = 10;
      if (dlqDepth >= DLQ_ALERT_THRESHOLD) {
        logger.warn({ dlqDepth }, "[cron/payouts] DLQ depth alert: payout_dead_letter_queue has many entries");
        await db.query(
          `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
           VALUES ('payout_dlq_depth', 'warning', $1, $2::jsonb, NOW())
           ON CONFLICT DO NOTHING`,
          [
            `Payout DLQ has ${dlqDepth} entries — manual review required`,
            JSON.stringify({ dlqDepth }),
          ]
        ).catch(() => {});
      }
    } catch (err) {
      logger.warn({ err }, "[cron/payouts] Failed to check DLQ depth");
    }

    return NextResponse.json({
      success: true,
      result,
      reconcileResult,
      dlqDepth,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[cron/payouts] Fatal error");
    return NextResponse.json(
      {
        error: "Internal error during payout processing",
        message: err instanceof Error ? err.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
};
