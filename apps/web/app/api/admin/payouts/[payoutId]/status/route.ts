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
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";

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

      const { rows } = await db.query<{
        id: string;
        creator_id: string;
        gross_kobo: number;
        net_kobo: number;
        status: string;
        payout_method: string;
      }>(
        `SELECT id, creator_id, gross_kobo, net_kobo, status, payout_method
         FROM creator_payouts WHERE id = $1 LIMIT 1`,
        [payoutId]
      );

      if (!rows[0]) throw notFound("Payout not found");

      const payout = rows[0];
      const allowed = ALLOWED_TRANSITIONS[payout.status] ?? [];

      if (!allowed.includes(body.status)) {
        throw badRequest(
          `Cannot transition from '${payout.status}' to '${body.status}'.`,
          "INVALID_TRANSITION"
        );
      }

      await db.transaction(async (tx) => {
        const updates: string[] = ["status = $1", "updated_at = NOW()"];
        const queryParams: (string | number)[] = [body.status];
        let pIdx = 2;

        if (body.status === "completed") {
          updates.push(`completed_at = NOW()`);
        }

        if (body.note) {
          updates.push(`rejection_reason = $${pIdx++}`);
          queryParams.push(body.note);
        }

        await tx.query(
          `UPDATE creator_payouts SET ${updates.join(", ")} WHERE id = $${pIdx}`,
          [...queryParams, payoutId]
        );

        // Restore earnings on failure or cancellation
        if (body.status === "failed" || body.status === "cancelled") {
          await tx.query(
            `UPDATE users
             SET available_earnings_kobo = available_earnings_kobo + $1, updated_at = NOW()
             WHERE id = $2`,
            [payout.gross_kobo, payout.creator_id]
          );
        }
      });

      // Audit log
      await db
        .query(
          `INSERT INTO admin_audit_log
             (admin_id, action, resource, resource_id, after_val, created_at)
           VALUES ($1, 'payout_status_updated', 'creator_payouts', $2, $3::jsonb, NOW())`,
          [
            adminId,
            payoutId,
            JSON.stringify({
              fromStatus: payout.status,
              toStatus: body.status,
              method: payout.payout_method,
              note: body.note,
            }),
          ]
        )
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
          ? `Your payout of ₦${(payout.net_kobo / 100).toFixed(2)} has been completed.`
          : body.status === "failed"
          ? "Your payout could not be completed. Your earnings have been restored to your balance."
          : body.status === "cancelled"
          ? "Your payout was cancelled. Your earnings have been restored to your balance."
          : `Your payout status has been updated to: ${body.status}.`;

      await db
        .query(
          `INSERT INTO notifications
             (user_id, type, title, body, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, NOW())`,
          [
            payout.creator_id,
            `payout_${body.status}`,
            notifTitle,
            notifBody,
            JSON.stringify({ payoutId, status: body.status }),
          ]
        )
        .catch(() => {});

      return NextResponse.json({
        success: true,
        payoutId,
        previousStatus: payout.status,
        newStatus: body.status,
        earningsRestored:
          body.status === "failed" || body.status === "cancelled"
            ? payout.gross_kobo
            : undefined,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
