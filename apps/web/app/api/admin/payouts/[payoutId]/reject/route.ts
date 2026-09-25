export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/payouts/[payoutId]/reject
 *
 * Admin-only: reject a pending payout and restore the creator's available earnings.
 *
 * @module app/api/admin/payouts/[payoutId]/reject
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";

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

      const orm = await getDb();

      const [payoutRow] = await orm
        .select({
          id: schema.creatorPayouts.id,
          creator_id: schema.creatorPayouts.creatorId,
          gross_kobo: schema.creatorPayouts.grossKobo,
          status: schema.creatorPayouts.status,
        })
        .from(schema.creatorPayouts)
        .where(eq(schema.creatorPayouts.id, payoutId))
        .limit(1);

      if (!payoutRow) {
        throw notFound("Payout not found");
      }

      const payout = payoutRow;
      const grossKobo = payout.gross_kobo ?? BigInt(0);

      if (payout.status !== "awaiting_approval") {
        throw badRequest(`Cannot reject a payout in status: ${payout.status}`);
      }

      // Atomically: mark rejected and restore earnings
      await orm.transaction(async (tx) => {
        await tx
          .update(schema.creatorPayouts)
          .set({
            status: "rejected",
            rejectionReason: body.reason,
            rejectedAt: new Date(),
            appealStatus: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.creatorPayouts.id, payoutId));

        // Restore the gross amount to the creator's available earnings
        await tx
          .update(schema.users)
          .set({
            availableEarningsKobo: sql`${schema.users.availableEarningsKobo} + ${grossKobo}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, payout.creator_id));
      });

      // Notify creator
      await orm
        .insert(schema.notifications)
        .values({
          userId: payout.creator_id,
          type: "payout_rejected",
          title: "Payout Rejected",
          body: `Your payout was rejected. Reason: ${body.reason} You may submit an appeal if you believe this is an error.`,
          metadata: { payoutId, reason: body.reason },
        })
        .catch(() => {});

      return NextResponse.json({
        success: true,
        payoutId,
        status: "rejected",
        reason: body.reason,
        earningsRestored: Number(grossKobo),
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
