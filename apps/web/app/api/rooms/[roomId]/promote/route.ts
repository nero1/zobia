export const dynamic = 'force-dynamic';

/**
 * app/api/rooms/[roomId]/promote/route.ts
 *
 * POST /api/rooms/:roomId/promote
 *
 * Allows a room creator to promote their room for a fixed number of hours
 * by spending coins. Promoted rooms receive elevated visibility in listings.
 *
 * Coin costs:
 *   6 hours  → 500 coins
 *   12 hours → 900 coins
 *   24 hours → 1,500 coins
 *
 * If the room is already promoted, the promotion end time is extended
 * by the purchased duration (promotions stack additively).
 *
 * Auth: required (withAuth — only the room creator may promote).
 * Rate limit: RATE_LIMITS.apiWrite.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import {
  handleApiError,
  badRequest,
  forbidden,
  notFound,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { debitCoins } from "@/lib/economy/coins";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const promoteRoomSchema = z.object({
  /**
   * Duration of the promotion in hours.
   * Must be exactly 6, 12, or 24.
   */
  hours: z
    .number()
    .int("hours must be an integer")
    .min(1, "hours must be at least 1")
    .max(24, "hours cannot exceed 24"),
});

// ---------------------------------------------------------------------------
// Cost lookup
// ---------------------------------------------------------------------------

/**
 * Coin cost map keyed by promotion duration in hours.
 * Only the three canonical durations are offered.
 */
const PROMOTION_COSTS: Record<number, number> = {
  6: 500,
  12: 900,
  24: 1_500,
};

/** Allowed promotion durations. */
const ALLOWED_HOURS = Object.keys(PROMOTION_COSTS).map(Number);

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface RoomOwnerRow {
  id: string;
  creator_id: string;
}

interface PromotionRow {
  id: string;
  room_id: string;
  promoted_by: string;
  coin_cost: number;
  starts_at: string;
  ends_at: string;
}

// ---------------------------------------------------------------------------
// POST /api/rooms/[roomId]/promote
// ---------------------------------------------------------------------------

/**
 * Promote a room for enhanced visibility by debiting coins from the creator.
 *
 * Flow:
 *   1. Validate auth + rate limit.
 *   2. Validate request body (hours ∈ {6, 12, 24}).
 *   3. Verify the room exists and belongs to the authenticated user.
 *   4. Compute coin cost from the hours → cost lookup.
 *   5. Atomically debit coins (records ledger entry internally).
 *   6. Upsert the room_promotions record — extends ends_at if already active.
 *   7. Return promotion details.
 *
 * @param req    - Incoming request with JSON body { hours }
 * @param params - Route params containing roomId
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { roomId } = await params as { roomId: string };
    const body = await validateBody(req, promoteRoomSchema);

    // Validate that the requested hours is one of the supported tiers
    if (!ALLOWED_HOURS.includes(body.hours)) {
      throw badRequest(
        `Unsupported promotion duration. Allowed values: ${ALLOWED_HOURS.join(", ")} hours.`,
        "INVALID_HOURS"
      );
    }

    const coinCost = PROMOTION_COSTS[body.hours];

    // 1. Verify room exists and caller is the creator
    const { rows: roomRows } = await db.query<RoomOwnerRow>(
      `SELECT id, creator_id
       FROM rooms
       WHERE id = $1 AND is_active = TRUE
       LIMIT 1`,
      [roomId]
    );

    const room = roomRows[0];
    if (!room) throw notFound("Room not found");
    if (room.creator_id !== auth.user.sub) {
      throw forbidden("Only the room creator can promote this room");
    }

    // 2. Debit coins atomically — debitCoins writes the ledger entry internally.
    // SYS-CL-02: room_promotions.room_id is UNIQUE and upserted, so its row id
    // stays identical across repeat/extended purchases for the same room — using
    // it (or the bare roomId) as the debit reference would collide on the second
    // purchase. Generate a fresh UUID per purchase instead.
    const purchaseRef = randomUUID();
    await debitCoins(
      auth.user.sub,
      coinCost,
      "room_promotion",
      purchaseRef,
      `Room promotion: ${body.hours}h for room ${roomId}`,
      { roomId, hours: body.hours, coinCost }
    );

    // 3. Upsert room_promotions — extend ends_at if an active promotion exists
    const { rows: promotionRows } = await db.query<PromotionRow>(
      `INSERT INTO room_promotions
         (room_id, promoted_by, coin_cost, starts_at, ends_at)
       VALUES
         ($1, $2, $3, NOW(), NOW() + ($4 || ' hours')::interval)
       ON CONFLICT (room_id)
       DO UPDATE SET
         ends_at    = GREATEST(room_promotions.ends_at, EXCLUDED.ends_at),
         coin_cost  = room_promotions.coin_cost + EXCLUDED.coin_cost,
         updated_at = NOW()
       RETURNING id, room_id, promoted_by, coin_cost, starts_at, ends_at`,
      [roomId, auth.user.sub, coinCost, body.hours]
    );

    const promotion = promotionRows[0];

    return NextResponse.json(
      {
        roomId,
        promotedUntil: promotion.ends_at,
        coinCost,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
