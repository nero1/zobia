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
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";

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

      const { rows } = await db.query<{
        id: string;
        creator_id: string;
        gross_kobo: number;
        status: string;
        appeal_status: string | null;
        payout_method: string;
      }>(
        `SELECT id, creator_id, gross_kobo, status, appeal_status, payout_method
         FROM creator_payouts WHERE id = $1 LIMIT 1`,
        [payoutId]
      );

      if (!rows[0]) throw notFound("Payout not found");

      const payout = rows[0];

      if (payout.appeal_status !== "pending") {
        throw badRequest(
          "This payout does not have a pending appeal.",
          "NO_PENDING_APPEAL"
        );
      }

      if (body.action === "approve") {
        // Re-open the payout: deduct from creator balance again and queue for processing
        await db.transaction(async (tx) => {
          // Check if creator still has enough balance (they may have spent it)
          const { rows: balanceRows } = await tx.query<{ available: number }>(
            `SELECT available_earnings_kobo AS available FROM users WHERE id = $1 FOR UPDATE`,
            [payout.creator_id]
          );
          const available = balanceRows[0]?.available ?? 0;
          if (available < payout.gross_kobo) {
            throw badRequest(
              "Creator does not have sufficient earnings balance to re-process this payout.",
              "INSUFFICIENT_EARNINGS"
            );
          }

          await tx.query(
            `UPDATE users
             SET available_earnings_kobo = available_earnings_kobo - $1, updated_at = NOW()
             WHERE id = $2`,
            [payout.gross_kobo, payout.creator_id]
          );

          await tx.query(
            `UPDATE creator_payouts
             SET status = 'awaiting_approval',
                 appeal_status = 'resolved',
                 appeal_resolved_at = NOW(),
                 appeal_resolved_by = $1,
                 rejection_reason = NULL,
                 updated_at = NOW()
             WHERE id = $2`,
            [adminId, payoutId]
          );
        });
      } else {
        // Dismiss appeal
        await db.query(
          `UPDATE creator_payouts
           SET appeal_status = 'dismissed',
               appeal_resolved_at = NOW(),
               appeal_resolved_by = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [adminId, payoutId]
        );
      }

      // Audit log
      await db
        .query(
          `INSERT INTO admin_audit_log
             (admin_id, action, resource, resource_id, after_val, created_at)
           VALUES ($1, $2, 'creator_payouts', $3, $4::jsonb, NOW())`,
          [
            adminId,
            body.action === "approve" ? "payout_appeal_approved" : "payout_appeal_dismissed",
            payoutId,
            JSON.stringify({ action: body.action, note: body.note }),
          ]
        )
        .catch(() => {});

      // Notify creator
      const notifTitle = body.action === "approve" ? "Appeal Approved" : "Appeal Dismissed";
      const notifBody =
        body.action === "approve"
          ? "Your payout appeal has been approved. Your payout has been re-queued for processing."
          : `Your payout appeal has been reviewed and dismissed.${body.note ? " Note: " + body.note : ""}`;

      await db
        .query(
          `INSERT INTO notifications
             (user_id, type, title, body, metadata, created_at)
           VALUES ($1, 'payout_appeal_resolved', $2, $3, $4::jsonb, NOW())`,
          [
            payout.creator_id,
            notifTitle,
            notifBody,
            JSON.stringify({ payoutId, action: body.action }),
          ]
        )
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
