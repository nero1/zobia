/**
 * POST /api/admin/payouts/[payoutId]/reject
 *
 * Admin-only: reject a pending payout and restore the creator's available earnings.
 *
 * @module app/api/admin/payouts/[payoutId]/reject
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";

interface PayoutRow {
  id: string;
  creator_id: string;
  gross_kobo: number;
  status: string;
}

const RejectSchema = z.object({
  /** Human-readable reason for rejection (shown to the creator). */
  reason: z.string().min(10, "Rejection reason must be at least 10 characters").max(500),
});

/**
 * POST /api/admin/payouts/[payoutId]/reject
 *
 * Body: { reason: string }
 * Rejects the payout and restores earnings to the creator's available balance.
 */
export const POST = withAdminAuth(
  async (
    req: NextRequest,
    { params }: { params: { payoutId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { payoutId } = params;
      const body = await validateBody(req, RejectSchema);

      const { rows } = await db.query<PayoutRow>(
        `SELECT id, creator_id, gross_kobo, status
         FROM creator_payouts WHERE id = $1 LIMIT 1`,
        [payoutId]
      );

      if (!rows[0]) {
        throw notFound("Payout not found");
      }

      const payout = rows[0];

      if (payout.status !== "awaiting_approval") {
        throw badRequest(`Cannot reject a payout in status: ${payout.status}`);
      }

      // Atomically: mark rejected and restore earnings
      await db.transaction(async (tx) => {
        await tx.query(
          `UPDATE creator_payouts
           SET status = 'rejected',
               rejection_reason = $1,
               rejected_at = NOW(),
               appeal_status = NULL,
               updated_at = NOW()
           WHERE id = $2`,
          [body.reason, payoutId]
        );

        // Restore the gross amount to the creator's available earnings
        await tx.query(
          `UPDATE users
           SET available_earnings_kobo = available_earnings_kobo + $1, updated_at = NOW()
           WHERE id = $2`,
          [payout.gross_kobo, payout.creator_id]
        );
      });

      // Notify creator
      await db
        .query(
          `INSERT INTO notifications
             (user_id, type, title, body, metadata, created_at)
           VALUES ($1, 'payout_rejected', 'Payout Rejected',
             $2, $3::jsonb, NOW())`,
          [
            payout.creator_id,
            `Your payout was rejected. Reason: ${body.reason} You may submit an appeal if you believe this is an error.`,
            JSON.stringify({ payoutId, reason: body.reason }),
          ]
        )
        .catch(() => {});

      return NextResponse.json({
        success: true,
        payoutId,
        status: "rejected",
        reason: body.reason,
        earningsRestored: payout.gross_kobo,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
