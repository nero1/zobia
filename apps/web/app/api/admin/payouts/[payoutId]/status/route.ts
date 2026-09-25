export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/payouts/[payoutId]/status
 *
 * Admin: manually update the status of a payout.
 *
 * Used for:
 *   - Manual Nigeria mode: marking bank_transfer payouts as processing/completed/failed
 *   - All global (non-Nigeria) payouts: admin manually sends funds and marks complete
 *   - Crypto payouts: admin manually sends USDT and marks complete
 *
 * Allowed transitions from current status:
 *   awaiting_approval → processing, cancelled
 *   processing        → completed, failed
 *   failed            → processing (re-attempt after fixing)
 *
 * On 'completed': creator receives in-app notification.
 * On 'failed':    earnings restored to creator; notification sent.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";

const StatusSchema = z.object({
  status: z.enum(["processing", "completed", "failed", "cancelled"]),
  note: z.string().max(500).optional(),
});

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  awaiting_approval: ["processing", "cancelled"],
  processing: ["completed", "failed"],
  failed: ["processing"],
  pending: ["processing", "completed", "failed", "cancelled"],
};

export const PATCH = withAdminAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { payoutId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { payoutId } = params;
      const adminId = auth.user.sub;
      const body = await validateBody(req, StatusSchema);

      const orm = await getDb();

      const [payout] = await orm
        .select({
          id: schema.creatorPayouts.id,
          creator_id: schema.creatorPayouts.creatorId,
          gross_kobo: schema.creatorPayouts.grossKobo,
          net_kobo: schema.creatorPayouts.netKobo,
          status: schema.creatorPayouts.status,
          payout_method: schema.creatorPayouts.payoutMethod,
        })
        .from(schema.creatorPayouts)
        .where(eq(schema.creatorPayouts.id, payoutId))
        .limit(1);

      if (!payout) throw notFound("Payout not found");

      const grossKobo = payout.gross_kobo ?? BigInt(0);
      const netKobo = payout.net_kobo ?? BigInt(0);
      const allowed = ALLOWED_TRANSITIONS[payout.status] ?? [];

      if (!allowed.includes(body.status)) {
        throw badRequest(
          `Cannot transition from '${payout.status}' to '${body.status}'.`,
          "INVALID_TRANSITION"
        );
      }

      await orm.transaction(async (tx) => {
        const setValues: Partial<typeof schema.creatorPayouts.$inferInsert> = {
          status: body.status,
          updatedAt: new Date(),
        };
        if (body.status === "completed") {
          setValues.completedAt = new Date();
        }
        if (body.note) {
          setValues.rejectionReason = body.note;
        }

        await tx.update(schema.creatorPayouts).set(setValues).where(eq(schema.creatorPayouts.id, payoutId));

        // Restore earnings on failure or cancellation
        if (body.status === "failed" || body.status === "cancelled") {
          await tx
            .update(schema.users)
            .set({
              availableEarningsKobo: sql`${schema.users.availableEarningsKobo} + ${grossKobo}`,
              updatedAt: new Date(),
            })
            .where(eq(schema.users.id, payout.creator_id));
        }
      });

      // Audit log
      await orm
        .insert(schema.adminAuditLog)
        .values({
          adminId,
          action: "payout_status_updated",
          resource: "creator_payouts",
          resourceId: payoutId,
          afterVal: {
            fromStatus: payout.status,
            toStatus: body.status,
            method: payout.payout_method,
            note: body.note,
          },
        })
        .catch(() => {});

      // Notify creator
      const notifTitle =
        body.status === "completed"
          ? "Payout Completed"
          : body.status === "failed"
          ? "Payout Failed"
          : body.status === "cancelled"
          ? "Payout Cancelled"
          : "Payout Update";

      const notifBody =
        body.status === "completed"
          ? `Your payout of ₦${(Number(netKobo) / 100).toFixed(2)} has been completed.`
          : body.status === "failed"
          ? "Your payout could not be completed. Your earnings have been restored to your balance."
          : body.status === "cancelled"
          ? "Your payout was cancelled. Your earnings have been restored to your balance."
          : `Your payout status has been updated to: ${body.status}.`;

      await orm
        .insert(schema.notifications)
        .values({
          userId: payout.creator_id,
          type: `payout_${body.status}`,
          title: notifTitle,
          body: notifBody,
          metadata: { payoutId, status: body.status },
        })
        .catch(() => {});

      return NextResponse.json({
        success: true,
        payoutId,
        previousStatus: payout.status,
        newStatus: body.status,
        earningsRestored:
          body.status === "failed" || body.status === "cancelled"
            ? Number(grossKobo)
            : undefined,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
