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
import { processPendingPayouts } from "@/lib/payments/payouts";
import { env } from "@/lib/env";

export const POST = async (req: NextRequest) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!env.CRON_SECRET || token !== env.CRON_SECRET) {
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

    return NextResponse.json({
      success: true,
      result,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[cron/payouts] Fatal error:", err);
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
