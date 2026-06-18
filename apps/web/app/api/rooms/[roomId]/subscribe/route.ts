export const dynamic = 'force-dynamic';

/**
 * app/api/rooms/[roomId]/subscribe/route.ts
 *
 * POST /api/rooms/:roomId/subscribe
 *
 * Subscribe to a VIP room.
 *
 * Flow:
 *  1. Validate the room is type=vip and active.
 *  2. Check for existing active subscription (idempotent).
 *  3. Calculate subscription amount from room.subscription_price_ngn.
 *  4. Debit from user's coin balance (if sufficient) or initiate card payment.
 *  5. Create room_subscriptions record (status=active, expires 30 days).
 *  6. Credit creator earnings at 80% net (20% platform fee per PRD).
 *  7. Join the room if not already a member.
 *
 * Revenue split: 80% net to creator, 20% platform fee.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import {
  handleApiError,
  notFound,
  forbidden,
  conflict,
  badRequest,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { initializePayment } from "@/lib/payments";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default creator share (80%); Icon creators receive 85%. */
const DEFAULT_CREATOR_SHARE_PERCENT = 80;
const ICON_CREATOR_SHARE_PERCENT = 85;

/** Subscription duration in days. */
const SUBSCRIPTION_DAYS = 30;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const subscribeSchema = z.object({
  /**
   * Payment method:
   *  - "balance"     : deduct from user's coin/fiat balance
   *  - "card"        : initiate card payment (returns paymentUrl)
   */
  paymentMethod: z.enum(["balance", "card"]).default("balance"),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface RoomRow {
  id: string;
  type: string;
  creator_id: string;
  creator_tier: string | null;
  is_active: boolean;
  subscription_price_ngn: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check for an existing active subscription for this room and user.
 */
async function hasActiveSubscription(
  roomId: string,
  userId: string
): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM room_subscriptions
     WHERE room_id = $1 AND user_id = $2 AND status = 'active' AND expires_at > NOW()
     LIMIT 1`,
    [roomId, userId]
  );
  return rows.length > 0;
}

/**
 * Credit creator earnings at 80% of gross amount.
 * Creates a creator_earnings record in a transaction.
 *
 * @param tx          - Active transaction client
 * @param creatorId   - Room creator UUID
 * @param grossKobo   - Gross subscription price in kobo (NGN × 100)
 * @param referenceId - Reference ID (subscription record ID)
 */
async function creditCreatorEarnings(
  tx: Awaited<Parameters<Parameters<typeof db.transaction>[0]>[0]>,
  creatorId: string,
  grossKobo: number,
  referenceId: string,
  creatorSharePercent: number = DEFAULT_CREATOR_SHARE_PERCENT
): Promise<void> {
  const netKobo = Math.floor((grossKobo * creatorSharePercent) / 100);
  const platformFeeKobo = grossKobo - netKobo;

  await tx.query(
    `INSERT INTO creator_earnings
       (creator_id, source_type, gross_amount_kobo, platform_fee_kobo, net_amount_kobo, reference_id)
     VALUES ($1, 'subscription', $2, $3, $4, $5)`,
    [creatorId, grossKobo, platformFeeKobo, netKobo, referenceId]
  );
  // Increment available balance so manual payout route sees the accrual
  await tx.query(
    `UPDATE users
     SET available_earnings_kobo = COALESCE(available_earnings_kobo, 0) + $1,
         updated_at = NOW()
     WHERE id = $2`,
    [netKobo, creatorId]
  );
}

// ---------------------------------------------------------------------------
// POST /api/rooms/[roomId]/subscribe
// ---------------------------------------------------------------------------

/**
 * Subscribe to a VIP room.
 *
 * On success, the caller is added as a room member if not already.
 *
 * @param req    - Incoming request with paymentMethod body
 * @param params - Route params containing roomId
 * @returns Subscription record on success or paymentUrl for card payments
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { roomId } = await params as { roomId: string };
    const userId = auth.user.sub;
    const body = await validateBody(req, subscribeSchema);

    // Fetch room (join creator_tier for revenue share calculation)
    const { rows: roomRows } = await db.query<RoomRow>(
      `SELECT r.id, r.type, r.creator_id, u.creator_tier, r.is_active, r.subscription_price_ngn
       FROM rooms r
       JOIN users u ON u.id = r.creator_id
       WHERE r.id = $1`,
      [roomId]
    );
    const room = roomRows[0];
    if (!room || !room.is_active) throw notFound("Room not found");
    if (room.type !== "vip") {
      throw badRequest("This endpoint is only for VIP rooms");
    }
    if (!room.subscription_price_ngn) {
      throw badRequest("This VIP room has no subscription price configured");
    }
    if (room.creator_id === userId) {
      throw forbidden("Room creators cannot subscribe to their own room");
    }

    // Idempotency check
    if (await hasActiveSubscription(roomId, userId)) {
      throw conflict("You already have an active subscription to this room");
    }

    const grossKobo = room.subscription_price_ngn * 100; // NGN to kobo
    const expiresAt = new Date(
      Date.now() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    if (body.paymentMethod === "card") {
      // Fetch user email for payment provider
      const { rows: emailRows } = await db.query<{ email: string }>(
        `SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId]
      );
      const email = emailRows[0]?.email;
      if (!email) throw notFound("User not found");

      const idempotencyKey = `room_sub:${userId}:${roomId}:${Date.now()}`;
      const returnUrl = `${env.NEXT_PUBLIC_APP_URL}/rooms/${roomId}/subscribe/callback`;
      const metadata = {
        itemType: "room_subscription",
        userId,
        roomId,
        grossKobo,
        subscriptionDays: SUBSCRIPTION_DAYS,
      };

      const paymentResult = await initializePayment(
        grossKobo,
        "NGN",
        email,
        idempotencyKey,
        metadata,
        returnUrl
      );

      // Persist the pending payment record so the webhook can activate it
      await db.query(
        `INSERT INTO payments
           (user_id, payment_type, amount_kobo, currency, status,
            idempotency_key, provider_reference, payment_url, metadata)
         VALUES ($1, 'room_subscription', $2, 'NGN', 'pending', $3, $4, $5, $6)`,
        [
          userId,
          grossKobo,
          idempotencyKey,
          paymentResult.providerReference,
          paymentResult.paymentUrl,
          JSON.stringify(metadata),
        ]
      );

      return NextResponse.json(
        {
          requiresCardPayment: true,
          paymentUrl: paymentResult.paymentUrl,
          paymentReference: paymentResult.providerReference,
        },
        { status: 200 }
      );
    }

    // Naira → coins at 1 NGN = 1 coin (platform configures actual rate via manifest)
    const requiredCoins = room.subscription_price_ngn;

    const subscription = await db.transaction(async (tx) => {
      // Balance payment — lock the row inside the transaction so concurrent
      // requests cannot both pass the balance check and overdraft the account.
      const { rows: userRows } = await tx.query<{ coin_balance: number }>(
        `SELECT coin_balance FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [userId]
      );
      const user = userRows[0];
      if (!user) throw notFound("User not found");

      if (user.coin_balance < requiredCoins) {
        throw badRequest(
          `Insufficient balance. You need ${requiredCoins} coins for this subscription.`,
          "INSUFFICIENT_COINS"
        );
      }

      // Debit coins
      await tx.query(
        `UPDATE users
         SET coin_balance = coin_balance - $1, updated_at = NOW()
         WHERE id = $2`,
        [requiredCoins, userId]
      );

      await tx.query(
        `INSERT INTO coin_ledger
           (user_id, amount, balance_before, balance_after, transaction_type, reference_id, description)
         VALUES ($1, $2, $3, $4, 'subscription', $5, $6)`,
        [
          userId,
          -requiredCoins,
          user.coin_balance,
          user.coin_balance - requiredCoins,
          roomId,
          `VIP room subscription: ${roomId}`,
        ]
      );

      // Create subscription record
      const { rows: subRows } = await tx.query<{ id: string }>(
        `INSERT INTO room_subscriptions
           (room_id, user_id, status, amount_kobo, started_at, expires_at)
         VALUES ($1, $2, 'active', $3, NOW(), $4)
         RETURNING *`,
        [roomId, userId, grossKobo, expiresAt]
      );

      const sub = subRows[0];
      if (!sub) throw new Error("Subscription creation failed");

      // Credit creator earnings (85% for Icon creators, 80% otherwise)
      const creatorShare = room.creator_tier === "icon" ? ICON_CREATOR_SHARE_PERCENT : DEFAULT_CREATOR_SHARE_PERCENT;
      await creditCreatorEarnings(tx, room.creator_id, grossKobo, sub.id, creatorShare);

      // Join room if not already a member
      await tx.query(
        `INSERT INTO room_members (room_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', NOW())
         ON CONFLICT (room_id, user_id) DO NOTHING`,
        [roomId, userId]
      );

      // Increment member_count (may be a no-op if already counted)
      await tx.query(
        `UPDATE rooms
         SET member_count = member_count + 1, updated_at = NOW()
         WHERE id = $1
           AND NOT EXISTS (
             SELECT 1 FROM room_members
             WHERE room_id = $1 AND user_id = $2
           )`,
        [roomId, userId]
      );

      return sub;
    });

    return NextResponse.json({ subscription }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
