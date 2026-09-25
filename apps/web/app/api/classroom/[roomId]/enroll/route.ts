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
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
    const orm = await getDb();

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

      const [existing] = await orm
        .select({ id: schema.classroomEnrolments.id })
        .from(schema.classroomEnrolments)
        .where(and(eq(schema.classroomEnrolments.roomId, roomId), eq(schema.classroomEnrolments.userId, userId)))
        .limit(1);
      if (existing) throw conflict("You are already enrolled in this classroom");

      const [userRow] = await orm
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
        .limit(1);
      const email = userRow?.email ?? `${userId}@zobia.social`;
      const amountKobo = room.feeNgn * 100;
      const reference = classroomPaymentReference(roomId, userId);

      await orm.insert(schema.payments).values({
        userId,
        referenceId: roomId,
        provider: "paystack",
        providerReference: reference,
        paymentType: "room_entry",
        amountKobo: BigInt(amountKobo),
        currency: "NGN",
        status: "pending",
        metadata: { roomId, roomName: room.name, userId, itemType: "classroom_enrolment" },
        idempotencyKey: reference,
      });

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";
      const [slugRow] = await orm
        .select({ slug: schema.rooms.slug })
        .from(schema.rooms)
        .where(eq(schema.rooms.id, roomId))
        .limit(1);
      const callbackUrl = `${appUrl}/c/${slugRow?.slug ?? roomId}?payment=complete`;
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
