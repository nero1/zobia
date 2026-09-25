export const dynamic = 'force-dynamic';

/**
 * app/api/rooms/[roomId]/pay-entry/route.ts
 *
 * POST /api/rooms/:roomId/pay-entry
 *
 * Pay the entry fee for a Drop room.
 *
 * Drop rooms charge a one-time entry fee in Naira (stored as entry_fee_ngn).
 * This endpoint:
 *  1. Validates the room is of type 'drop' and has an entry fee.
 *  2. Validates the drop session is still open (drop_ends_at > NOW()).
 *  3. Initiates a Paystack payment and returns a payment URL.
 *  4. Records a pending payment record.
 *
 * After the user completes payment on Paystack, the webhook (economy/webhooks/paystack)
 * marks the payment as 'completed' and the user can then call /rooms/[roomId]/join.
 *
 * NOTE: this endpoint only initiates a card payment (Paystack) — there is no
 * coin-balance decrement or row-locking here. The pending `payments` row is
 * activated by the Paystack webhook once payment completes.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import {
  handleApiError,
  notFound,
  badRequest,
  conflict,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { initializePayment } from "@/lib/payments/paystack";

// ---------------------------------------------------------------------------
// POST /api/rooms/[roomId]/pay-entry
// ---------------------------------------------------------------------------

export const POST = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { roomId: string }; auth: { user: { sub: string } } }
) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { roomId } = await params as { roomId: string };
    const userId = auth.user.sub;
    const orm = await getDb();

    // 1. Fetch room
    const [room] = await orm
      .select({
        id: schema.rooms.id,
        type: schema.rooms.type,
        name: schema.rooms.name,
        entryFeeNgn: schema.rooms.entryFeeNgn,
        dropEndsAt: schema.rooms.dropEndsAt,
        isActive: schema.rooms.isActive,
      })
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId));
    if (!room || !room.isActive) throw notFound("Room not found");
    if (room.type !== "drop") throw badRequest("This room does not require an entry payment");
    if (!room.entryFeeNgn || room.entryFeeNgn <= 0) {
      throw badRequest("This Drop room has no entry fee");
    }

    // 2. Check session is still open
    if (room.dropEndsAt && new Date(room.dropEndsAt) < new Date()) {
      throw badRequest("This Drop room session has ended");
    }

    // 3. Idempotency: check if already paid
    const [existingPayment] = await orm
      .select({ id: schema.payments.id })
      .from(schema.payments)
      .where(and(
        eq(schema.payments.userId, userId),
        eq(schema.payments.referenceId, roomId),
        eq(schema.payments.paymentType, 'room_entry'),
        eq(schema.payments.status, 'completed'),
      ))
      .limit(1);
    if (existingPayment) {
      throw conflict("You have already paid for this room. Call /join to enter.");
    }

    // 4. Fetch user email for Paystack
    const [userRow] = await orm
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), sql`${schema.users.deletedAt} IS NULL`))
      .limit(1);
    const userEmail = userRow?.email ?? `${userId}@zobia.social`;

    // 5. Compute amount in kobo (NGN × 100)
    const entryFeeNgn = Number(room.entryFeeNgn);
    const amountKobo = entryFeeNgn * 100;
    const paymentRef = `dropentr-${roomId.replace(/-/g, "").slice(0, 12)}-${userId.replace(/-/g, "").slice(0, 8)}-${Date.now()}`;

    // 6. Create pending payment record. `provider` is NOT NULL with no default —
    // omitting it (as this INSERT used to) failed every Drop-room card payment.
    await orm.insert(schema.payments).values({
      userId,
      referenceId: roomId,
      provider: 'paystack',
      providerReference: paymentRef,
      paymentType: 'room_entry',
      amountKobo: BigInt(amountKobo),
      currency: 'NGN',
      status: 'pending',
      metadata: {
        roomId,
        roomName: room.name,
        userId,
        itemType: "room_entry",
      },
    });

    // 7. Initiate Paystack payment
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";
    const callbackUrl = `${appUrl}/rooms/${roomId}?payment=complete`;

    const paymentData = await initializePayment(
      amountKobo,
      userEmail,
      paymentRef,
      {
        userId,
        packId: roomId,
        coinsGranted: 0,
        itemType: "room_entry",
        packName: `Entry: ${room.name}`,
      },
      callbackUrl,
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          paymentRef,
          paymentUrl: paymentData.authorization_url,
          amountNgn: entryFeeNgn,
          roomName: room.name,
        },
        error: null,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
