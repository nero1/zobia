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
import { eq, sql } from "drizzle-orm";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";

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

    const orm = await getDb();
    await orm.transaction(async (tx) => {
      // 1. Load the DLQ item and lock it
      const [dlq] = await tx
        .select({
          id: schema.payoutDeadLetterQueue.id,
          payout_id: schema.payoutDeadLetterQueue.payoutId,
          creator_id: schema.payoutDeadLetterQueue.creatorId,
          resolved_at: schema.payoutDeadLetterQueue.resolvedAt,
        })
        .from(schema.payoutDeadLetterQueue)
        .where(eq(schema.payoutDeadLetterQueue.id, dlqId))
        .for("update");

      if (!dlq) throw notFound("DLQ item not found");
      if (dlq.resolved_at) throw badRequest("This DLQ item has already been resolved");

      // 2. Load the originating payout
      const [payout] = await tx
        .select({
          id: schema.creatorPayouts.id,
          status: schema.creatorPayouts.status,
          gross_kobo: schema.creatorPayouts.grossKobo,
          creator_id: schema.creatorPayouts.creatorId,
        })
        .from(schema.creatorPayouts)
        .where(eq(schema.creatorPayouts.id, dlq.payout_id))
        .for("update");

      if (!payout) throw notFound("Originating payout not found");
      const grossKobo = payout.gross_kobo ?? BigInt(0);

      // 3. Debit creator's available_earnings_kobo (restored when item was DLQ'd)
      //    before re-queuing — otherwise the creator would have free earnings.
      const [userRow] = await tx
        .select({ available_earnings_kobo: schema.users.availableEarningsKobo })
        .from(schema.users)
        .where(eq(schema.users.id, dlq.creator_id))
        .for("update");
      const available = userRow?.available_earnings_kobo ?? BigInt(0);
      if (available < grossKobo) {
        throw badRequest(
          "Creator's available earnings balance is insufficient to re-queue this payout. " +
          "Ensure the creator's balance has been restored before retrying."
        );
      }

      await tx
        .update(schema.users)
        .set({
          availableEarningsKobo: sql`${schema.users.availableEarningsKobo} - ${grossKobo}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, dlq.creator_id));

      // 4. Reset the payout back to 'pending' with a fresh retry counter
      await tx
        .update(schema.creatorPayouts)
        .set({ status: "pending", retryCount: 0, nextRetryAt: null, updatedAt: new Date() })
        .where(eq(schema.creatorPayouts.id, payout.id));

      // 5. Mark the DLQ item as resolved
      await tx
        .update(schema.payoutDeadLetterQueue)
        .set({ resolvedAt: new Date(), resolutionNote: `[Admin: ${auth.user.sub}] ${adminNote}` })
        .where(eq(schema.payoutDeadLetterQueue.id, dlqId));
    });

    return NextResponse.json({ success: true, message: "Payout re-queued for processing" });
  } catch (err) {
    return handleApiError(err);
  }
});
