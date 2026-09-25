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
import { eq, and, gt, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
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
  const orm = await getDb();
  const [row] = await orm
    .select({ id: schema.roomSubscriptions.id })
    .from(schema.roomSubscriptions)
    .where(and(
      eq(schema.roomSubscriptions.roomId, roomId),
      eq(schema.roomSubscriptions.userId, userId),
      eq(schema.roomSubscriptions.status, 'active'),
      gt(schema.roomSubscriptions.expiresAt, sql`NOW()`),
    ))
    .limit(1);
  return !!row;
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
  tx: DbOrTx,
  creatorId: string,
  grossKobo: number,
  referenceId: string,
  creatorSharePercent: number = DEFAULT_CREATOR_SHARE_PERCENT
): Promise<void> {
  const netKobo = Math.floor((grossKobo * creatorSharePercent) / 100);
  const platformFeeKobo = grossKobo - netKobo;

  await tx.insert(schema.creatorEarnings).values({
    creatorId,
    sourceType: 'subscription',
    grossAmountKobo: BigInt(grossKobo),
    platformFeeKobo: BigInt(platformFeeKobo),
    netAmountKobo: BigInt(netKobo),
    referenceId,
  });
  // Increment available balance so manual payout route sees the accrual
  await tx
    .update(schema.users)
    .set({
      availableEarningsKobo: sql`COALESCE(${schema.users.availableEarningsKobo}, 0) + ${netKobo}`,
      updatedAt: sql`NOW()`,
    })
    .where(eq(schema.users.id, creatorId));
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
    const orm = await getDb();

    // Fetch room (join creator_tier for revenue share calculation)
    const [room] = await orm
      .select({
        id: schema.rooms.id,
        type: schema.rooms.type,
        creator_id: schema.rooms.creatorId,
        creator_tier: schema.users.creatorTier,
        is_active: schema.rooms.isActive,
        subscription_price_ngn: schema.rooms.subscriptionPriceNgn,
      })
      .from(schema.rooms)
      .innerJoin(schema.users, eq(schema.users.id, schema.rooms.creatorId))
      .where(eq(schema.rooms.id, roomId));

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

    const subscriptionPriceNgn = Number(room.subscription_price_ngn);
    const grossKobo = subscriptionPriceNgn * 100; // NGN to kobo
    const expiresAtDate = new Date(
      Date.now() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000
    );

    if (body.paymentMethod === "card") {
      // Fetch user email for payment provider
      const [emailRow] = await orm
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(and(eq(schema.users.id, userId), sql`${schema.users.deletedAt} IS NULL`))
        .limit(1);
      const email = emailRow?.email;
      if (!email) throw notFound("User not found");

      const idempotencyKey = `room-sub-${userId}-${roomId}-${Date.now()}`;
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
      await orm.insert(schema.payments).values({
        userId,
        paymentType: 'room_subscription',
        amountKobo: BigInt(grossKobo),
        currency: 'NGN',
        status: 'pending',
        idempotencyKey,
        providerReference: paymentResult.providerReference,
        paymentUrl: paymentResult.paymentUrl,
        metadata,
        provider: 'paystack',
      });

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
    const requiredCoins = subscriptionPriceNgn;

    const subscription = await orm.transaction(async (tx) => {
      // Balance payment — lock the row inside the transaction so concurrent
      // requests cannot both pass the balance check and overdraft the account.
      const [user] = await tx
        .select({ coinBalance: schema.users.coinBalance })
        .from(schema.users)
        .where(and(eq(schema.users.id, userId), sql`${schema.users.deletedAt} IS NULL`))
        .for('update');
      if (!user) throw notFound("User not found");

      if (user.coinBalance < BigInt(requiredCoins)) {
        throw badRequest(
          `Insufficient balance. You need ${requiredCoins} coins for this subscription.`,
          "INSUFFICIENT_COINS"
        );
      }

      // Debit coins
      await tx
        .update(schema.users)
        .set({ coinBalance: sql`${schema.users.coinBalance} - ${requiredCoins}`, updatedAt: sql`NOW()` })
        .where(eq(schema.users.id, userId));

      const balanceBefore = user.coinBalance;
      const balanceAfter = user.coinBalance - BigInt(requiredCoins);

      await tx.insert(schema.coinLedger).values({
        userId,
        amount: BigInt(-requiredCoins),
        balanceBefore,
        balanceAfter,
        transactionType: 'subscription',
        referenceId: roomId,
        description: `VIP room subscription: ${roomId}`,
      });

      // Create subscription record
      const [sub] = await tx
        .insert(schema.roomSubscriptions)
        .values({
          roomId,
          userId,
          status: 'active',
          amountKobo: BigInt(grossKobo),
          startedAt: sql`NOW()`,
          expiresAt: expiresAtDate,
        })
        .returning();

      if (!sub) throw new Error("Subscription creation failed");

      // Credit creator earnings (85% for Icon creators, 80% otherwise)
      const creatorShare = room.creator_tier === "icon" ? ICON_CREATOR_SHARE_PERCENT : DEFAULT_CREATOR_SHARE_PERCENT;
      await creditCreatorEarnings(tx, room.creator_id, grossKobo, sub.id, creatorShare);

      // Join room if not already a member; RETURNING tells us if a new row was inserted.
      const insertedMember = await tx
        .insert(schema.roomMembers)
        .values({ roomId, userId, role: 'member', joinedAt: sql`NOW()` })
        .onConflictDoNothing()
        .returning({ roomId: schema.roomMembers.roomId });

      // Only increment member_count when the INSERT actually added a new row.
      if (insertedMember[0]) {
        await tx
          .update(schema.rooms)
          .set({ memberCount: sql`${schema.rooms.memberCount} + 1`, updatedAt: sql`NOW()` })
          .where(eq(schema.rooms.id, roomId));
      }

      return sub;
    });

    return NextResponse.json(
      { subscription: { ...subscription, amountKobo: Number(subscription.amountKobo ?? 0) } },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
