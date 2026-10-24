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
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { debitCoins } from "@/lib/economy/coins";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createRefundSchema = z.object({
  /** Target user's UUID. */
  userId: z.string().uuid(),
  /** Number of coins to refund (positive integer). */
  amountCoins: z.number().int().positive({ message: "amountCoins must be a positive integer" }).max(Number.MAX_SAFE_INTEGER),
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

    const orm = await getDb();

    try {
      const statusCondition =
        status === "all"
          ? sql`TRUE`
          : status === "processed"
          ? sql`${schema.refunds.status} = 'processed'`
          : sql`${schema.refunds.status} = 'pending'`;

      const rows = await orm
        .select({
          id: schema.refunds.id,
          user_id: schema.refunds.userId,
          username: schema.users.username,
          amount_coins: schema.refunds.amountCoins,
          reason: schema.refunds.reason,
          reference_id: schema.refunds.referenceId,
          status: schema.refunds.status,
          processed_by: schema.refunds.processedBy,
          created_at: schema.refunds.createdAt,
          processed_at: schema.refunds.processedAt,
        })
        .from(schema.refunds)
        .leftJoin(schema.users, eq(schema.users.id, schema.refunds.userId))
        .where(statusCondition)
        .orderBy(sql`${schema.refunds.createdAt} DESC`)
        .limit(limit)
        .offset(offset);

      const { rows: countRows } = await orm.execute<{ total: string }>(
        sql`SELECT COUNT(*)::TEXT AS total FROM refunds r WHERE ${statusCondition}`
      );

      refunds = rows.map((r) => ({
        ...r,
        amount_coins: Number(r.amount_coins),
        created_at: r.created_at ? r.created_at.toISOString() : "",
        processed_at: r.processed_at ? r.processed_at.toISOString() : null,
      })) as unknown as RefundRow[];
      total = parseInt(countRows[0]?.total ?? "0", 10);
    } catch {
      // refunds table probably does not exist yet — surface recent purchases as
      // refund candidates so the page is still useful.
      const rows = await orm
        .select({
          id: schema.coinLedger.id,
          user_id: schema.coinLedger.userId,
          username: schema.users.username,
          amount: schema.coinLedger.amount,
          description: schema.coinLedger.description,
          created_at: schema.coinLedger.createdAt,
        })
        .from(schema.coinLedger)
        .leftJoin(schema.users, eq(schema.users.id, schema.coinLedger.userId))
        .where(sql`${schema.coinLedger.transactionType} = 'purchase' AND ${schema.coinLedger.amount} > 0`)
        .orderBy(sql`${schema.coinLedger.createdAt} DESC`)
        .limit(limit)
        .offset(offset);

      const { rows: countRows } = await orm.execute<{ total: string }>(
        sql`SELECT COUNT(*)::TEXT AS total
         FROM coin_ledger
         WHERE transaction_type = 'purchase' AND amount > 0`
      );

      refunds = rows.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        username: r.username,
        amount_coins: Number(r.amount),
        reason: r.description ?? "Purchase (refund candidate)",
        reference_id: r.id,
        status: "pending",
        processed_by: null,
        created_at: r.created_at ? r.created_at.toISOString() : "",
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

    const orm = await getDb();

    // 1. Verify the user exists and fetch current balance
    const [user] = await orm
      .select({ id: schema.users.id, username: schema.users.username, coin_balance: schema.users.coinBalance })
      .from(schema.users)
      .where(sql`${schema.users.id} = ${body.userId} AND ${schema.users.deletedAt} IS NULL`)
      .limit(1);

    if (!user) {
      throw notFound("User not found");
    }

    // 2. Execute all writes in a transaction
    const result = await orm.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM users WHERE id=${body.userId} FOR UPDATE`);
      const original=await tx.execute<{id:string;amount:string}>(sql`SELECT id,amount::text FROM (SELECT id,user_id,amount,transaction_type,reference_id,created_at FROM coin_ledger UNION ALL SELECT id,user_id,amount,transaction_type,reference_id,created_at FROM coin_ledger_archive) purchases WHERE user_id=${body.userId} AND amount>0 AND transaction_type='purchase' AND (id::text=${body.referenceId} OR reference_id=${body.referenceId}) ORDER BY created_at,id LIMIT 1`);
      if(!original.rows.length || BigInt(body.amountCoins)>BigInt(original.rows[0].amount))throw badRequest("Refund must reference an original purchase and cannot exceed its credit");
      const purchaseId=original.rows[0].id;
      const [existing]=await tx.select().from(schema.refunds).where(and(eq(schema.refunds.userId,body.userId),eq(schema.refunds.referenceId,purchaseId))).limit(1);
      if(existing) {
        if(existing.amountCoins!==BigInt(body.amountCoins))throw badRequest("Refund reference already used with a different amount");
        const [current]=await tx.select({balance:schema.users.coinBalance}).from(schema.users).where(eq(schema.users.id,body.userId));
        return {refundId:existing.id,newBalance:Number(current.balance)};
      }

      const entry=await debitCoins(body.userId,body.amountCoins,"refund",`refund:${purchaseId}`,`Refund: ${body.reason}`,null,tx);
      const [refundRow]=await tx.insert(schema.refunds).values({userId:body.userId,amountCoins:BigInt(body.amountCoins),reason:body.reason,referenceId:purchaseId,status:"processed",processedBy:auth.user.sub,processedAt:new Date()}).returning({id:schema.refunds.id});
      const refundId=refundRow.id;
      const newBalance=entry.balanceAfter;
      return { refundId, newBalance: Number(newBalance) };
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
