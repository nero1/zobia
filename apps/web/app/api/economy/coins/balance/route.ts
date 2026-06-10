export const dynamic = 'force-dynamic';

/**
 * GET /api/economy/coins/balance
 *
 * Returns the authenticated user's current coin balance, star balance,
 * and their recent coin transaction history.
 *
 * @module app/api/economy/coins/balance
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { getBalance, getLedgerEntries } from "@/lib/economy/coins";
import { getStarBalance, getStarLedgerEntries } from "@/lib/economy/stars";

/**
 * GET /api/economy/coins/balance
 *
 * Query params:
 *   - limit: number of recent transactions to return (default 20, max 50)
 *
 * Returns:
 * ```json
 * {
 *   "coins": 1250,
 *   "stars": 5,
 *   "transactions": [
 *     {
 *       "id": "...",
 *       "amount": 500,
 *       "balanceBefore": 750,
 *       "balanceAfter": 1250,
 *       "type": "purchase",
 *       "description": "Purchased Starter Pack",
 *       "createdAt": "2026-06-02T..."
 *     }
 *   ]
 * }
 * ```
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    const url = new URL(req.url);
    const rawLimit = parseInt(url.searchParams.get("limit") ?? "20", 10);
    const limit = Math.min(Math.max(1, rawLimit), 50);

    // Fetch user row (xp_total + plan), balances, and ledger entries in parallel
    const [userRow, coins, stars, coinLedger, starLedger] = await Promise.all([
      db.query<{ xp_total: number; plan: string | null }>(
        `SELECT xp_total, plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId]
      ).then((r) => r.rows[0] ?? { xp_total: 0, plan: null }),
      getBalance(userId).catch(() => 0),
      getStarBalance(userId).catch(() => 0),
      getLedgerEntries(userId, limit).catch(() => []),
      getStarLedgerEntries(userId, limit).catch(() => []),
    ]);

    // Shape the ledger entries for the client
    const transactions = coinLedger.map((entry) => ({
      id: entry.id,
      amount: entry.amount,
      balanceBefore: entry.balance_before,
      balanceAfter: entry.balance_after,
      type: entry.transaction_type,
      referenceId: entry.reference_id ?? null,
      description: entry.description ?? null,
      createdAt: entry.created_at,
    }));

    const starTransactions = starLedger.map((entry) => ({
      id: entry.id,
      amount: entry.amount,
      balanceBefore: entry.balance_before,
      balanceAfter: entry.balance_after,
      type: entry.transaction_type,
      referenceId: entry.reference_id ?? null,
      description: entry.description ?? null,
      createdAt: entry.created_at,
    }));

    return NextResponse.json({
      coins,
      stars,
      xp: userRow.xp_total ?? 0,
      plan: userRow.plan ?? null,
      transactions,
      starTransactions,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
