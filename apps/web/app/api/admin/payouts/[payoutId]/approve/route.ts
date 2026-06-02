/**
 * POST /api/admin/payouts/[payoutId]/approve
 *
 * Admin-only: approve a pending payout and trigger the payment provider transfer.
 *
 * @module app/api/admin/payouts/[payoutId]/approve
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { createPayout } from "@/lib/payments";

interface PayoutRow {
  id: string;
  creator_id: string;
  net_kobo: number;
  gross_kobo: number;
  status: string;
  idempotency_key: string;
  payout_recipient_code: string | null;
}

/**
 * POST /api/admin/payouts/[payoutId]/approve
 *
 * Approves the payout and initiates the bank transfer.
 */
export const POST = withAdminAuth(
  async (
    _req: NextRequest,
    { params }: { params: { payoutId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { payoutId } = params;

      const { rows } = await db.query<PayoutRow>(
        `SELECT cp.id, cp.creator_id, cp.net_kobo, cp.gross_kobo,
                cp.status, cp.idempotency_key, u.payout_recipient_code
         FROM creator_payouts cp
         JOIN users u ON u.id = cp.creator_id
         WHERE cp.id = $1 LIMIT 1`,
        [payoutId]
      );

      if (!rows[0]) {
        throw notFound("Payout not found");
      }

      const payout = rows[0];

      if (payout.status !== "awaiting_approval") {
        throw badRequest(`Cannot approve a payout in status: ${payout.status}`);
      }

      if (!payout.payout_recipient_code) {
        throw badRequest("Creator has no payout account configured");
      }

      // Initiate the actual bank transfer
      const payoutResult = await createPayout(
        payout.net_kobo,
        "NGN",
        {
          recipientCode: payout.payout_recipient_code,
          reason: "Creator payout (admin approved)",
        },
        `${payout.idempotency_key}:approved`
      );

      // Mark as processing
      await db.query(
        `UPDATE creator_payouts
         SET status = 'processing',
             provider_reference = $1,
             approved_at = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [payoutResult.providerId, payoutId]
      );

      return NextResponse.json({
        success: true,
        payoutId,
        providerReference: payoutResult.providerId,
        status: "processing",
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
