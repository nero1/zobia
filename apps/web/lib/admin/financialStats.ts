/**
 * lib/admin/financialStats.ts
 *
 * Coin economy / revenue / payout summary queries shared between
 * app/api/admin/financial/route.ts (own dashboard, unchanged behavior) and
 * app/api/admin/data-management/stats/route.ts (Financial tab, wrapped in
 * the 30-minute stats cache — see lib/admin/statsCache.ts).
 *
 * Extracted verbatim from app/api/admin/financial/route.ts — no query
 * changes, just moved so both routes import the same implementation instead
 * of duplicating it.
 */

import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Coin economy summary
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

export async function getCoinEconomy() {
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
// Revenue by provider
// ---------------------------------------------------------------------------

interface RevenueRow {
  provider: string;
  revenue_today_kobo: string;
  revenue_week_kobo: string;
  revenue_month_kobo: string;
  transaction_count: string;
}

export async function getRevenueByProvider() {
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
// Payout summary
// ---------------------------------------------------------------------------

interface PayoutSummaryRow {
  awaiting_approval_count: string;
  awaiting_approval_gross_kobo: string;
  processing_count: string;
  processing_gross_kobo: string;
  completed_month_kobo: string;
}

export async function getPayoutSummary() {
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
