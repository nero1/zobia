export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/payouts/[payoutId]/appeal
 *
 * Admin: resolve a creator's payout appeal.
 *
 * action='approve': Re-opens the payout (status → 'awaiting_approval' for a
 *                   second round of review, or 'pending' for auto-process).
 *                   If earnings were previously restored on rejection, they are
 *                   re-deducted here.
 *
 * action='dismiss': Marks the appeal as dismissed. Creator is notified.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";

const AppealResolveSchema = z.object({
  action: z.enum(["approve", "dismiss"]),
  note: z.string().max(500).optional(),
});

export const PATCH = withAdminAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { payoutId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { payoutId } = params;
      const adminId = auth.user.sub;
      const body = await validateBody(req, AppealResolveSchema);

      const orm = await getDb();

      const [payout] = await orm
        .select({
          id: schema.creatorPayouts.id,
          creator_id: schema.creatorPayouts.creatorId,
          gross_kobo: schema.creatorPayouts.grossKobo,
          status: schema.creatorPayouts.status,
          appeal_status: schema.creatorPayouts.appealStatus,
          payout_method: schema.creatorPayouts.payoutMethod,
        })
        .from(schema.creatorPayouts)
        .where(eq(schema.creatorPayouts.id, payoutId))
        .limit(1);

      if (!payout) throw notFound("Payout not found");

      if (payout.appeal_status !== "pending") {
        throw badRequest(
          "This payout does not have a pending appeal.",
          "NO_PENDING_APPEAL"
        );
      }

      const grossKobo = payout.gross_kobo ?? BigInt(0);

      if (body.action === "approve") {
        // Re-open the payout: deduct from creator balance again and queue for processing
        await orm.transaction(async (tx) => {
          // Check if creator still has enough balance (they may have spent it)
          const [balanceRow] = await tx
            .select({ available: schema.users.availableEarningsKobo })
            .from(schema.users)
            .where(eq(schema.users.id, payout.creator_id))
            .for("update");
          const available = balanceRow?.available ?? BigInt(0);
          if (available < grossKobo) {
            throw badRequest(
              "Creator does not have sufficient earnings balance to re-process this payout.",
              "INSUFFICIENT_EARNINGS"
            );
          }

          await tx
            .update(schema.users)
            .set({
              availableEarningsKobo: sql`${schema.users.availableEarningsKobo} - ${grossKobo}`,
              updatedAt: new Date(),
            })
            .where(eq(schema.users.id, payout.creator_id));

          await tx
            .update(schema.creatorPayouts)
            .set({
              status: "awaiting_approval",
              appealStatus: "resolved",
              appealResolvedAt: new Date(),
              appealResolvedBy: adminId,
              rejectionReason: null,
              updatedAt: new Date(),
            })
            .where(eq(schema.creatorPayouts.id, payoutId));
        });
      } else {
        // Dismiss appeal
        await orm
          .update(schema.creatorPayouts)
          .set({
            appealStatus: "dismissed",
            appealResolvedAt: new Date(),
            appealResolvedBy: adminId,
            updatedAt: new Date(),
          })
          .where(eq(schema.creatorPayouts.id, payoutId));
      }

      // Audit log
      await orm
        .insert(schema.adminAuditLog)
        .values({
          adminId,
          action: body.action === "approve" ? "payout_appeal_approved" : "payout_appeal_dismissed",
          resource: "creator_payouts",
          resourceId: payoutId,
          afterVal: { action: body.action, note: body.note },
        })
        .catch(() => {});

      // Notify creator
      const notifTitle = body.action === "approve" ? "Appeal Approved" : "Appeal Dismissed";
      const notifBody =
        body.action === "approve"
          ? "Your payout appeal has been approved. Your payout has been re-queued for processing."
          : `Your payout appeal has been reviewed and dismissed.${body.note ? " Note: " + body.note : ""}`;

      await orm
        .insert(schema.notifications)
        .values({
          userId: payout.creator_id,
          type: "payout_appeal_resolved",
          title: notifTitle,
          body: notifBody,
          metadata: { payoutId, action: body.action },
        })
        .catch(() => {});

      return NextResponse.json({
        success: true,
        payoutId,
        appealResolved: body.action,
        newPayoutStatus: body.action === "approve" ? "awaiting_approval" : payout.status,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
