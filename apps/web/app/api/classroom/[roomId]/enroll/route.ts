export const dynamic = 'force-dynamic';

/**
 * app/api/classroom/[roomId]/enroll/route.ts
 *
 * POST /api/classroom/:roomId/enroll   { paymentMethod?: 'balance' | 'card' }
 *
 * Enrol in a classroom.
 *   - Free classroom, or paymentMethod 'balance': Credits are debited through
 *     the coin ledger and the enrolment, room membership and creator earnings
 *     commit in one transaction (lib/classroom/enrolment.ts).
 *   - paymentMethod 'card' on a paid classroom: a pending Paystack payment is
 *     created and its checkout URL returned; the enrolment is written by the
 *     Paystack webhook (itemType 'classroom_enrolment') once the charge
 *     succeeds.
 *
 * Creator revenue (80%, 85% for Icon creators) lands in the creator's
 * available_earnings_kobo — withdrawn through the existing
 * /api/creator/payouts flow.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { initializePayment } from "@/lib/payments/paystack";
import { logger } from "@/lib/logger";
import { assertUuid } from "@/lib/classroom/http";
import { classroomPaymentReference, enrolWithBalance, loadEnrolmentRoom } from "@/lib/classroom/enrolment";
import { getUserRegion } from "@/lib/currency/region";

/** Paystack's own minimum chargeable amount (₦100). Below this, card
 *  checkout is refused by Paystack itself, so we never offer it. */
const PAYSTACK_MIN_NGN = 100;

const enrolSchema = z.object({
  paymentMethod: z.enum(["balance", "card"]).default("balance"),
});

export const POST = withAuth<{ roomId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    await requireFeatureEnabled("classrooms");

    const roomId = assertUuid(params.roomId);
    const userId = auth.user.sub;
    const body = await validateBody(req, enrolSchema);

    const room = await loadEnrolmentRoom(roomId);
    if (!room.isActive) throw badRequest("This classroom isn't accepting new members right now.", "CLASSROOM_ARCHIVED");
    if (room.creatorId === userId) throw badRequest("You can't enrol in your own classroom.");

    if (room.feeNgn > 0 && body.paymentMethod === "card") {
      if (room.feeNgn < PAYSTACK_MIN_NGN) {
        throw badRequest(
          `Card payment requires at least ₦${PAYSTACK_MIN_NGN}. Please pay with Credits instead.`,
          "BELOW_PAYSTACK_MINIMUM"
        );
      }
      const region = await getUserRegion(userId, req);
      if (!region.isNigeria) {
        throw badRequest(
          "Card payment is only available in Nigeria right now. Please pay with Credits instead.",
          "UNSUPPORTED_REGION"
        );
      }

      const { rows: existing } = await db.query<{ id: string }>(
        `SELECT id FROM classroom_enrolments WHERE room_id = $1 AND user_id = $2`,
        [roomId, userId]
      );
      if (existing[0]) throw conflict("You are already enrolled in this classroom");

      const { rows: userRows } = await db.query<{ email: string | null }>(
        `SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId]
      );
      const email = userRows[0]?.email ?? `${userId}@zobia.social`;
      const amountKobo = room.feeNgn * 100;
      const reference = classroomPaymentReference(roomId, userId);

      await db.query(
        `INSERT INTO payments
           (user_id, reference_id, provider, provider_reference, payment_type, amount_kobo, currency,
            status, metadata, idempotency_key, created_at)
         VALUES ($1, $2, 'paystack', $3, 'room_entry', $4, 'NGN', 'pending', $5::jsonb, $3, NOW())`,
        [
          userId,
          roomId,
          reference,
          amountKobo,
          JSON.stringify({ roomId, roomName: room.name, userId, itemType: "classroom_enrolment" }),
        ]
      );

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";
      const { rows: slugRows } = await db.query<{ slug: string | null }>(`SELECT slug FROM rooms WHERE id = $1`, [roomId]);
      const callbackUrl = `${appUrl}/c/${slugRows[0]?.slug ?? roomId}?payment=complete`;
      const payment = await initializePayment(
        amountKobo,
        email,
        reference,
        { userId, packId: roomId, roomId, coinsGranted: 0, itemType: "classroom_enrolment", packName: `Enrolment: ${room.name}` },
        callbackUrl
      );
      logger.info({ roomId, userId, reference }, "[classroom:enrol] card checkout initiated");
      return NextResponse.json(
        {
          success: true,
          data: { requiresCardPayment: true, paymentUrl: payment.authorization_url, paymentRef: reference },
          error: null,
        },
        { status: 200 }
      );
    }

    const result = await enrolWithBalance(roomId, userId);
    return NextResponse.json(
      { success: true, data: { enrolmentId: result.enrolmentId, paid: result.paid, xpAwarded: result.xpAwarded }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
