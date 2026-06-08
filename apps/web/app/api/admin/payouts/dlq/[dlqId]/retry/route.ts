export const dynamic = 'force-dynamic';

/**
 * app/api/admin/payouts/dlq/[dlqId]/retry/route.ts
 *
 * POST /api/admin/payouts/dlq/[dlqId]/retry
 *
 * Admin: re-queue a dead-letter payout for processing.
 *
 * Restores the originating creator_payouts row to 'pending' (resetting its
 * retry counter) so the next CRON run picks it up. Marks the DLQ record as
 * resolved with an admin note.
 *
 * The creator's earnings are NOT re-credited here — they were already
 * restored when the payout first entered the DLQ (see lib/payments/payouts.ts
 * moveToDeadLetterQueue). Re-queuing debits the earnings again as the payout
 * is reprocessed.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { db } from "@/lib/db";

interface DlqParams {
  dlqId: string;
}

const retrySchema = z.object({
  note: z.string().max(500).optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = withAdminAuth<DlqParams>(async (req: NextRequest, { params, auth }) => {
  try {
    const { dlqId } = params;
    if (!UUID_RE.test(dlqId)) throw badRequest("dlqId must be a valid UUID");

    const body = await validateBody(req, retrySchema);
    const adminNote = body.note ?? "Re-queued by admin";

    await db.transaction(async (tx) => {
      // 1. Load the DLQ item and lock it
      const { rows: dlqRows } = await tx.query<{
        id: string;
        payout_id: string;
        creator_id: string;
        resolved_at: string | null;
      }>(
        `SELECT id, payout_id, creator_id, resolved_at
         FROM payout_dead_letter_queue
         WHERE id = $1
         FOR UPDATE`,
        [dlqId]
      );

      const dlq = dlqRows[0];
      if (!dlq) throw notFound("DLQ item not found");
      if (dlq.resolved_at) throw badRequest("This DLQ item has already been resolved");

      // 2. Load the originating payout
      const { rows: payoutRows } = await tx.query<{
        id: string;
        status: string;
        gross_kobo: number;
        creator_id: string;
      }>(
        `SELECT id, status, gross_kobo, creator_id
         FROM creator_payouts
         WHERE id = $1
         FOR UPDATE`,
        [dlq.payout_id]
      );

      const payout = payoutRows[0];
      if (!payout) throw notFound("Originating payout not found");

      // 3. Debit creator's available_earnings_kobo (restored when item was DLQ'd)
      //    before re-queuing — otherwise the creator would have free earnings.
      const { rows: userRows } = await tx.query<{ available_earnings_kobo: number }>(
        `SELECT available_earnings_kobo FROM users WHERE id = $1 FOR UPDATE`,
        [dlq.creator_id]
      );
      const available = userRows[0]?.available_earnings_kobo ?? 0;
      if (available < payout.gross_kobo) {
        throw badRequest(
          "Creator's available earnings balance is insufficient to re-queue this payout. " +
          "Ensure the creator's balance has been restored before retrying."
        );
      }

      await tx.query(
        `UPDATE users
         SET available_earnings_kobo = available_earnings_kobo - $1,
             updated_at = NOW()
         WHERE id = $2`,
        [payout.gross_kobo, dlq.creator_id]
      );

      // 4. Reset the payout back to 'pending' with a fresh retry counter
      await tx.query(
        `UPDATE creator_payouts
         SET status = 'pending',
             retry_count = 0,
             next_retry_at = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [payout.id]
      );

      // 5. Mark the DLQ item as resolved
      await tx.query(
        `UPDATE payout_dead_letter_queue
         SET resolved_at = NOW(),
             resolution_note = $1
         WHERE id = $2`,
        [`[Admin: ${auth.user.sub}] ${adminNote}`, dlqId]
      );
    });

    return NextResponse.json({ success: true, message: "Payout re-queued for processing" });
  } catch (err) {
    return handleApiError(err);
  }
});
