export const dynamic = 'force-dynamic';

/**
 * POST /api/creator/payouts/[payoutId]/appeal
 *
 * Submit an appeal for a rejected payout.
 * Creator must own the payout and it must be in 'rejected' status.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, forbidden, notFound, handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { raiseAlert } from "@/lib/alerts/dispatch";

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

      const orm = await getDb();
      const rows = await orm
        .select({
          id: schema.creatorPayouts.id,
          creatorId: schema.creatorPayouts.creatorId,
          status: schema.creatorPayouts.status,
          appealStatus: schema.creatorPayouts.appealStatus,
        })
        .from(schema.creatorPayouts)
        .where(eq(schema.creatorPayouts.id, payoutId))
        .limit(1);

      if (!rows[0]) throw notFound("Payout not found");

      const payout = rows[0];

      if (payout.creatorId !== userId) {
        throw forbidden("You do not have access to this payout");
      }

      if (payout.status !== "rejected") {
        throw badRequest(
          "Only rejected payouts can be appealed.",
          "INVALID_STATUS"
        );
      }

      if (payout.appealStatus === "pending") {
        throw badRequest(
          "You already have a pending appeal for this payout.",
          "APPEAL_ALREADY_PENDING"
        );
      }

      await orm
        .update(schema.creatorPayouts)
        .set({
          appealReason: body.reason,
          appealStatus: "pending",
          appealSubmittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.creatorPayouts.id, payoutId));

      // Notify admin via system_alert
      await raiseAlert(orm, {
        type: "payout_appeal",
        category: "financial",
        priorityLevel: 4,
        title: "Payout appeal submitted",
        message: `Creator ${userId} submitted an appeal for rejected payout ${payoutId}.`,
        metadata: { payoutId, creatorId: userId, reason: body.reason },
        dedupeKey: `payout_appeal:${payoutId}`,
      }).catch(() => {});

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
