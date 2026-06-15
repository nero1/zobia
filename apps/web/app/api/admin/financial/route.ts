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

// ---------------------------------------------------------------------------
// Helper: coin economy summary
// ---------------------------------------------------------------------------

interface CoinEconomyRow {
  total_coins_in_circulation: string;
  coins_minted_today: string;
  coins_minted_week: string;
  coins_minted_month: string;
  coins_burned_today: string;
  coins_burned_week: string;
  coins_burned_month: string;
  coins_earned_today: string;
  coins_earned_week: string;
  coins_earned_month: string;
  total_users_with_coins: string;
}

async function getCoinEconomy() {
  const { rows } = await db.query<CoinEconomyRow>(
    `SELECT
       SUM(coin_balance)::TEXT AS total_coins_in_circulation,
       (SELECT COALESCE(SUM(amount), 0)::TEXT FROM coin_ledger
        WHERE transaction_type = 'purchase' AND created_at >= CURRENT_DATE
       ) AS coins_minted_today,
       (SELECT COALESCE(SUM(amount), 0)::TEXT FROM coin_ledger
        WHERE transaction_type = 'purchase' AND created_at >= CURRENT_DATE - INTERVAL '7 days'
       ) AS coins_minted_week,
       (SELECT COALESCE(SUM(amount), 0)::TEXT FROM coin_ledger
        WHERE transaction_type = 'purchase' AND created_at >= CURRENT_DATE - INTERVAL '30 days'
       ) AS coins_minted_month,
       (SELECT COALESCE(ABS(SUM(amount)), 0)::TEXT FROM coin_ledger
        WHERE amount < 0 AND created_at >= CURRENT_DATE
       ) AS coins_burned_today,
       (SELECT COALESCE(ABS(SUM(amount)), 0)::TEXT FROM coin_ledger
        WHERE amount < 0 AND created_at >= CURRENT_DATE - INTERVAL '7 days'
       ) AS coins_burned_week,
       (SELECT COALESCE(ABS(SUM(amount)), 0)::TEXT FROM coin_ledger
        WHERE amount < 0 AND created_at >= CURRENT_DATE - INTERVAL '30 days'
       ) AS coins_burned_month,
       (SELECT COALESCE(SUM(amount), 0)::TEXT FROM coin_ledger
        WHERE transaction_type NOT IN ('purchase') AND amount > 0 AND created_at >= CURRENT_DATE
       ) AS coins_earned_today,
       (SELECT COALESCE(SUM(amount), 0)::TEXT FROM coin_ledger
        WHERE transaction_type NOT IN ('purchase') AND amount > 0 AND created_at >= CURRENT_DATE - INTERVAL '7 days'
       ) AS coins_earned_week,
       (SELECT COALESCE(SUM(amount), 0)::TEXT FROM coin_ledger
        WHERE transaction_type NOT IN ('purchase') AND amount > 0 AND created_at >= CURRENT_DATE - INTERVAL '30 days'
       ) AS coins_earned_month,
       COUNT(*) FILTER (WHERE coin_balance > 0)::TEXT AS total_users_with_coins
     FROM users
     WHERE deleted_at IS NULL`
  );

  // Use Number() on BIGINT sums — safe up to 2^53. For coin aggregates in the
  // billions this is fine; if ever larger, switch to string and parse on the client (#25).
  const safeNum = (s: string | undefined) => Number(s ?? "0");

  const row = rows[0];
  const purchasedToday = safeNum(row?.coins_minted_today);
  const purchasedWeek  = safeNum(row?.coins_minted_week);
  const purchasedMonth = safeNum(row?.coins_minted_month);
  return {
    totalCoinsInCirculation: safeNum(row?.total_coins_in_circulation),
    purchasedToday,
    purchasedWeek,
    purchasedMonth,
    mintedToday: purchasedToday,
    mintedWeek: purchasedWeek,
    mintedMonth: purchasedMonth,
    burnedToday:  safeNum(row?.coins_burned_today),
    burnedWeek:   safeNum(row?.coins_burned_week),
    burnedMonth:  safeNum(row?.coins_burned_month),
    earnedToday:  safeNum(row?.coins_earned_today),
    earnedWeek:   safeNum(row?.coins_earned_week),
    earnedMonth:  safeNum(row?.coins_earned_month),
    usersWithCoins: safeNum(row?.total_users_with_coins),
  };
}

// ---------------------------------------------------------------------------
// Helper: revenue by provider
// ---------------------------------------------------------------------------

interface RevenueRow {
  provider: string;
  revenue_today_kobo: string;
  revenue_week_kobo: string;
  revenue_month_kobo: string;
  transaction_count: string;
}

async function getRevenueByProvider() {
  const { rows } = await db.query<RevenueRow>(
    `SELECT
       provider,
       SUM(amount_received_kobo) FILTER (
         WHERE completed_at >= CURRENT_DATE
       )::TEXT AS revenue_today_kobo,
       SUM(amount_received_kobo) FILTER (
         WHERE completed_at >= CURRENT_DATE - INTERVAL '7 days'
       )::TEXT AS revenue_week_kobo,
       SUM(amount_received_kobo) FILTER (
         WHERE completed_at >= CURRENT_DATE - INTERVAL '30 days'
       )::TEXT AS revenue_month_kobo,
       COUNT(*) FILTER (WHERE status = 'completed')::TEXT AS transaction_count
     FROM payments
     GROUP BY provider`
  );

  return rows.map((r) => ({
    provider: r.provider,
    revenueToday: Number(r.revenue_today_kobo ?? "0"),
    revenueWeek:  Number(r.revenue_week_kobo ?? "0"),
    revenueMonth: Number(r.revenue_month_kobo ?? "0"),
    transactionCount: Number(r.transaction_count ?? "0"),
  }));
}

// ---------------------------------------------------------------------------
// Helper: payout summary
// ---------------------------------------------------------------------------

interface PayoutSummaryRow {
  awaiting_approval_count: string;
  awaiting_approval_gross_kobo: string;
  processing_count: string;
  processing_gross_kobo: string;
  completed_month_kobo: string;
}

async function getPayoutSummary() {
  const { rows } = await db.query<PayoutSummaryRow>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'awaiting_approval')::TEXT AS awaiting_approval_count,
       COALESCE(SUM(gross_kobo) FILTER (WHERE status = 'awaiting_approval'), 0)::TEXT AS awaiting_approval_gross_kobo,
       COUNT(*) FILTER (WHERE status = 'processing')::TEXT AS processing_count,
       COALESCE(SUM(gross_kobo) FILTER (WHERE status = 'processing'), 0)::TEXT AS processing_gross_kobo,
       COALESCE(SUM(net_kobo) FILTER (
         WHERE status = 'completed' AND completed_at >= CURRENT_DATE - INTERVAL '30 days'
       ), 0)::TEXT AS completed_month_kobo
     FROM creator_payouts`
  );

  const row = rows[0];
  return {
    awaitingApproval: {
      count:     Number(row?.awaiting_approval_count ?? "0"),
      grossKobo: Number(row?.awaiting_approval_gross_kobo ?? "0"),
    },
    processing: {
      count:     Number(row?.processing_count ?? "0"),
      grossKobo: Number(row?.processing_gross_kobo ?? "0"),
    },
    completedThisMonthNetKobo: Number(row?.completed_month_kobo ?? "0"),
  };
}

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

  try {
    // Check for users with unusually large coin balances (> 1 million coins)
    const { rows: largeBalances } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM users WHERE coin_balance > 1000000 AND deleted_at IS NULL`
    );
    const largeCount = parseInt(largeBalances[0]?.count ?? "0", 10);
    if (largeCount > 0) {
      alerts.push({
        level: "warning",
        code: "LARGE_COIN_BALANCES",
        message: `${largeCount} user(s) have coin balances exceeding 1,000,000 coins.`,
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
        message: `Hourly coin minting (${hourly}) is 10× the 24h average (${dailyAvg.toFixed(0)}). Possible fraud.`,
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
    console.error("[admin/financial] Anomaly detection error:", err);
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
