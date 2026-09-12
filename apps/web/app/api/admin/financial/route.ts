export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/financial
 *
 * Admin-only: financial dashboard summary.
 *
 * Returns:
 *   - Coin economy health (total coins in circulation, minted today/week/month)
 *   - Revenue by payment provider
 *   - Payout account balance status
 *   - Anomaly alerts (unusual coin minting or spending spikes)
 *
 * All monetary values in kobo unless suffixed _coins.
 *
 * @module app/api/admin/financial
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/auditLog";
import { logger } from "@/lib/logger";
import { loadManifest } from "@/lib/manifest";
import { getCoinEconomy, getRevenueByProvider, getPayoutSummary } from "@/lib/admin/financialStats";

// Re-exported so app/api/admin/data-management/stats/route.ts (Financial tab)
// can import the same helpers from this route module if preferred — the
// canonical implementations now live in lib/admin/financialStats.ts.
export { getCoinEconomy, getRevenueByProvider, getPayoutSummary };

// ---------------------------------------------------------------------------
// Helper: anomaly detection (simple heuristics)
// ---------------------------------------------------------------------------

interface AnomalyAlert {
  level: "info" | "warning" | "critical";
  code: string;
  message: string;
}

async function detectAnomalies(): Promise<AnomalyAlert[]> {
  const alerts: AnomalyAlert[] = [];
  // Currency display name is admin-configurable (x_manifest currency_soft_name_*)
  // — never hard-code "coins" in alert text. See lib/manifest/index.ts.
  const manifest = await loadManifest();
  const currencyPlural = manifest.currency.softNamePlural.toLowerCase();

  try {
    // Check for users with unusually large balances (> 1 million)
    const { rows: largeBalances } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM users WHERE coin_balance > 1000000 AND deleted_at IS NULL`
    );
    const largeCount = parseInt(largeBalances[0]?.count ?? "0", 10);
    if (largeCount > 0) {
      alerts.push({
        level: "warning",
        code: "LARGE_COIN_BALANCES",
        message: `${largeCount} user(s) have ${currencyPlural} balances exceeding 1,000,000 ${currencyPlural}.`,
      });
    }

    // Check for unusual coin minting volume (> 10× yesterday's minting in last hour)
    const { rows: recentMinting } = await db.query<{ hourly: string; daily_avg: string }>(
      `SELECT
         COALESCE(SUM(amount) FILTER (
           WHERE created_at >= NOW() - INTERVAL '1 hour'
         ), 0)::TEXT AS hourly,
         COALESCE(SUM(amount) / 24.0, 1)::TEXT AS daily_avg
       FROM coin_ledger
       WHERE transaction_type = 'purchase'
         AND created_at >= NOW() - INTERVAL '24 hours'`
    );

    const hourly = parseFloat(recentMinting[0]?.hourly ?? "0");
    const dailyAvg = parseFloat(recentMinting[0]?.daily_avg ?? "1");
    if (hourly > dailyAvg * 10) {
      alerts.push({
        level: "critical",
        code: "COIN_MINTING_SPIKE",
        message: `Hourly ${currencyPlural} minting (${hourly}) is 10× the 24h average (${dailyAvg.toFixed(0)}). Possible fraud.`,
      });
    }

    // Check for failed payouts in the last 24 hours
    const { rows: failedPayouts } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM creator_payouts
       WHERE status = 'failed' AND updated_at >= NOW() - INTERVAL '24 hours'`
    );
    const failedCount = parseInt(failedPayouts[0]?.count ?? "0", 10);
    if (failedCount > 0) {
      alerts.push({
        level: "warning",
        code: "FAILED_PAYOUTS",
        message: `${failedCount} payout(s) failed in the last 24 hours. Check payment provider status.`,
      });
    }
  } catch (err) {
    logger.error({ err: err }, "[admin/financial] Anomaly detection error:");
    alerts.push({
      level: "info",
      code: "ANOMALY_CHECK_ERROR",
      message: "Could not complete anomaly detection checks.",
    });
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/financial
 *
 * Returns the full financial dashboard summary.
 */
export const GET = withAdminAuth(async (_req: NextRequest, _ctx) => {
  try {
    const [coinEconomy, revenueByProvider, payoutSummary, anomalyAlerts] =
      await Promise.all([
        getCoinEconomy(),
        getRevenueByProvider(),
        getPayoutSummary(),
        detectAnomalies(),
      ]);

    // BUG-45: audit read-path admin access to financial records
    writeAuditLog({
      actorId: _ctx.auth.user.sub,
      action: "financial_read",
      metadata: { generatedAt: new Date().toISOString() },
    });

    return NextResponse.json({
      coinEconomy,
      revenueByProvider,
      payoutSummary,
      anomalyAlerts,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return handleApiError(err);
  }
});
