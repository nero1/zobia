export const dynamic = 'force-dynamic';

/**
 * app/api/admin/refunds/route.ts
 *
 * Admin coin-refund management.
 *
 * GET /api/admin/refunds
 *   List refunds filtered by status (default: "pending").
 *   Falls back gracefully if the refunds table does not yet exist by querying
 *   coin_ledger for purchase transactions that have no corresponding refund.
 *
 *   Query params:
 *     status  – "pending" | "processed" | "all"  (default: "pending")
 *     limit   – max records                       (default: 50, max: 200)
 *     offset  – pagination offset                 (default: 0)
 *
 * POST /api/admin/refunds
 *   Process a coin refund.
 *   Body: { userId, amountCoins, reason, referenceId }
 *
 * Auth: admin only (withAdminAuth – live database is_admin check).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createRefundSchema = z.object({
  /** Target user's UUID. */
  userId: z.string().uuid(),
  /** Number of coins to refund (positive integer). */
  amountCoins: z.number().int().positive({ message: "amountCoins must be a positive integer" }),
  /** Human-readable reason for the refund. */
  reason: z.string().min(5).max(500),
  /** Reference to the original transaction (coin_ledger id or payment reference). */
  referenceId: z.string().min(1).max(200),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface RefundRow {
  id: string;
  user_id: string;
  username: string | null;
  amount_coins: number;
  reason: string;
  reference_id: string;
  status: string;
  processed_by: string | null;
  created_at: string;
  processed_at: string | null;
}

interface CoinLedgerRow {
  id: string;
  user_id: string;
  username: string | null;
  amount: number;
  description: string | null;
  created_at: string;
}

interface UserRow {
  id: string;
  username: string;
  coin_balance: number;
}

// ---------------------------------------------------------------------------
// GET /api/admin/refunds
// ---------------------------------------------------------------------------

export const GET = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "pending";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10), 0);

    // ------------------------------------------------------------------
    // Try to query the refunds table first. If it does not exist yet,
    // fall back to coin_ledger purchases as refund candidates.
    // ------------------------------------------------------------------

    let refunds: RefundRow[] = [];
    let total = 0;

    try {
      const whereStatus =
        status === "all"
          ? ""
          : status === "processed"
          ? "WHERE r.status = 'processed'"
          : "WHERE r.status = 'pending'";

      const { rows } = await db.query<RefundRow>(
        `SELECT r.id, r.user_id, u.username, r.amount_coins, r.reason,
                r.reference_id, r.status, r.processed_by, r.created_at, r.processed_at
         FROM refunds r
         LEFT JOIN users u ON u.id = r.user_id
         ${whereStatus}
         ORDER BY r.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      const { rows: countRows } = await db.query<{ total: string }>(
        `SELECT COUNT(*)::TEXT AS total FROM refunds r ${whereStatus}`
      );

      refunds = rows;
      total = parseInt(countRows[0]?.total ?? "0", 10);
    } catch {
      // refunds table probably does not exist yet — surface recent purchases as
      // refund candidates so the page is still useful.
      const { rows } = await db.query<CoinLedgerRow>(
        `SELECT cl.id, cl.user_id, u.username, cl.amount, cl.description, cl.created_at
         FROM coin_ledger cl
         LEFT JOIN users u ON u.id = cl.user_id
         WHERE cl.transaction_type = 'purchase'
           AND cl.amount > 0
         ORDER BY cl.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      const { rows: countRows } = await db.query<{ total: string }>(
        `SELECT COUNT(*)::TEXT AS total
         FROM coin_ledger
         WHERE transaction_type = 'purchase' AND amount > 0`
      );

      refunds = rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        username: r.username,
        amount_coins: r.amount,
        reason: r.description ?? "Purchase (refund candidate)",
        reference_id: r.id,
        status: "pending",
        processed_by: null,
        created_at: r.created_at,
        processed_at: null,
      }));
      total = parseInt(countRows[0]?.total ?? "0", 10);
    }

    return NextResponse.json({
      success: true,
      data: { refunds, total, limit, offset },
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/refunds
// ---------------------------------------------------------------------------

export const POST = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, createRefundSchema);

    // 1. Verify the user exists and fetch current balance
    const { rows: userRows } = await db.query<UserRow>(
      `SELECT id, username, coin_balance FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [body.userId]
    );

    const user = userRows[0];
    if (!user) {
      throw notFound("User not found");
    }

    if (user.coin_balance < body.amountCoins) {
      throw badRequest(
        `User only has ${user.coin_balance} coins — cannot refund ${body.amountCoins}`
      );
    }

    // 2. Execute all writes in a transaction
    const result = await db.transaction(async (tx) => {
      // Deduct the refund amount from the user's coin balance
      const { rows: updatedUser } = await tx.query<{ coin_balance: number }>(
        `UPDATE users
         SET coin_balance = coin_balance - $1,
             updated_at   = NOW()
         WHERE id = $2
         RETURNING coin_balance`,
        [body.amountCoins, body.userId]
      );

      const newBalance = updatedUser[0]?.coin_balance ?? 0;

      const balanceBefore = newBalance + body.amountCoins;

      // Record in coin_ledger as a refund (negative amount = deduction)
      const { rows: ledgerRows } = await tx.query<{ id: string }>(
        `INSERT INTO coin_ledger
           (user_id, amount, balance_before, balance_after, transaction_type, description, created_at)
         VALUES ($1, $2, $3, $4, 'refund', $5, NOW())
         RETURNING id`,
        [body.userId, -body.amountCoins, balanceBefore, newBalance, `Refund: ${body.reason}`]
      );

      const ledgerId = ledgerRows[0]?.id;

      // Insert into refunds table; ignore if table does not exist
      let refundId: string | null = null;
      try {
        const { rows: refundRows } = await tx.query<{ id: string }>(
          `INSERT INTO refunds
             (user_id, amount_coins, reason, reference_id, status, processed_by, created_at, processed_at)
           VALUES ($1, $2, $3, $4, 'processed', $5, NOW(), NOW())
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [body.userId, body.amountCoins, body.reason, body.referenceId, auth.user.sub]
        );
        refundId = refundRows[0]?.id ?? ledgerId ?? null;
      } catch {
        // refunds table may not exist; fall back to ledger id
        refundId = ledgerId ?? null;
      }

      return { refundId, newBalance };
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          refundId: result.refundId,
          newBalance: result.newBalance,
          username: user.username,
          amountRefunded: body.amountCoins,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
