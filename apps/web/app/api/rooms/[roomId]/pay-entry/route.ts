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
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import {
  handleApiError,
  notFound,
  badRequest,
  conflict,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { initiatePayment } from "@/lib/payments/paystack";

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface DropRoomRow {
  id: string;
  type: string;
  name: string;
  entry_fee_ngn: number | null;
  drop_ends_at: string | null;
  is_active: boolean;
}

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

    // 1. Fetch room
    const { rows: roomRows } = await db.query<DropRoomRow>(
      `SELECT id, type, name, entry_fee_ngn, drop_ends_at, is_active
       FROM rooms WHERE id = $1`,
      [roomId]
    );
    const room = roomRows[0];
    if (!room || !room.is_active) throw notFound("Room not found");
    if (room.type !== "drop") throw badRequest("This room does not require an entry payment");
    if (!room.entry_fee_ngn || room.entry_fee_ngn <= 0) {
      throw badRequest("This Drop room has no entry fee");
    }

    // 2. Check session is still open
    if (room.drop_ends_at && new Date(room.drop_ends_at) < new Date()) {
      throw badRequest("This Drop room session has ended");
    }

    // 3. Idempotency: check if already paid
    const { rows: existingPayment } = await db.query<{ id: string }>(
      `SELECT id FROM payments
       WHERE user_id = $1
         AND reference_id = $2
         AND payment_type = 'room_entry'
         AND status = 'completed'
       LIMIT 1`,
      [userId, roomId]
    );
    if (existingPayment.length > 0) {
      throw conflict("You have already paid for this room. Call /join to enter.");
    }

    // 4. Fetch user email for Paystack
    const { rows: userRows } = await db.query<{ email: string | null }>(
      `SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    const userEmail = userRows[0]?.email ?? `${userId}@zobia.social`;

    // 5. Compute amount in kobo (NGN × 100)
    const amountKobo = room.entry_fee_ngn * 100;
    const paymentRef = `dropentr_${roomId.replace(/-/g, "").slice(0, 12)}_${userId.replace(/-/g, "").slice(0, 8)}_${Date.now()}`;

    // 6. Create pending payment record
    await db.query(
      `INSERT INTO payments
         (user_id, reference_id, provider_reference, payment_type, amount_kobo, currency,
          status, metadata, created_at)
       VALUES ($1, $2, $3, 'room_entry', $4, 'NGN', 'pending', $5::jsonb, NOW())`,
      [
        userId,
        roomId,
        paymentRef,
        amountKobo,
        JSON.stringify({
          roomId,
          roomName: room.name,
          userId,
          itemType: "room_entry",
        }),
      ]
    );

    // 7. Initiate Paystack payment
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.social";
    const callbackUrl = `${appUrl}/rooms/${roomId}?payment=complete`;

    const paymentData = await initiatePayment({
      email: userEmail,
      amountKobo,
      reference: paymentRef,
      callbackUrl,
      metadata: {
        userId,
        packId: roomId,
        coinsGranted: 0,
        itemType: "room_entry" as const,
        packName: `Entry: ${room.name}`,
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          paymentRef,
          paymentUrl: paymentData.authorization_url,
          amountNgn: room.entry_fee_ngn,
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
