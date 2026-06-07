/**
 * POST /api/creator/payouts/[payoutId]/appeal
 *
 * Submit an appeal for a rejected payout.
 * Creator must own the payout and it must be in 'rejected' status.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, forbidden, notFound, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

const AppealSchema = z.object({
  reason: z
    .string()
    .min(20, "Appeal reason must be at least 20 characters")
    .max(1000, "Appeal reason must be at most 1000 characters"),
});

export const POST = withAuth(
  async (
    req: NextRequest,
    { auth, params }: { auth: { user: { sub: string } }; params: { payoutId: string } }
  ) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

      const userId = auth.user.sub;
      const { payoutId } = params;
      const body = await validateBody(req, AppealSchema);

      const { rows } = await db.query<{
        id: string;
        creator_id: string;
        status: string;
        appeal_status: string | null;
      }>(
        `SELECT id, creator_id, status, appeal_status
         FROM creator_payouts WHERE id = $1 LIMIT 1`,
        [payoutId]
      );

      if (!rows[0]) throw notFound("Payout not found");

      const payout = rows[0];

      if (payout.creator_id !== userId) {
        throw forbidden("You do not have access to this payout");
      }

      if (payout.status !== "rejected") {
        throw badRequest(
          "Only rejected payouts can be appealed.",
          "INVALID_STATUS"
        );
      }

      if (payout.appeal_status === "pending") {
        throw badRequest(
          "You already have a pending appeal for this payout.",
          "APPEAL_ALREADY_PENDING"
        );
      }

      await db.query(
        `UPDATE creator_payouts
         SET appeal_reason = $1,
             appeal_status = 'pending',
             appeal_submitted_at = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [body.reason, payoutId]
      );

      // Notify admin via system_alert
      await db
        .query(
          `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
           VALUES ('payout_appeal', 'warning', $1, $2::jsonb, NOW())`,
          [
            `Creator ${userId} submitted an appeal for rejected payout ${payoutId}.`,
            JSON.stringify({ payoutId, creatorId: userId, reason: body.reason }),
          ]
        )
        .catch(() => {});

      return NextResponse.json({
        success: true,
        appealStatus: "pending",
        message: "Your appeal has been submitted. Admin will review it and you will be notified of the outcome.",
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
