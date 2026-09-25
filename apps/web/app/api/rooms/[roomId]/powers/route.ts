export const dynamic = 'force-dynamic';

/**
 * app/api/rooms/[roomId]/powers/route.ts
 *
 * Room Powers — coin-purchasable in-room enhancements (PRD §11).
 *
 * POST /api/rooms/[roomId]/powers
 *   Apply a room power by deducting the required coins.
 *
 * Supported powers:
 *   - message_pin:       Pin a message in the room (caller must be room creator or co-mod)
 *   - room_spotlight:    Boost room in discovery for 24h (500 Coins)
 *   - member_highlight:  Highlight a member for 1h (200 Coins)
 *
 * All purchases are atomic: coin deduction + effect write in a single transaction.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Costs (in Coins)
// ---------------------------------------------------------------------------

const POWER_COSTS: Record<string, number> = {
  message_pin:      100,
  room_spotlight:   500,
  member_highlight: 200,
};

// PRD §11: Message Pin lasts 1 hour.
const MESSAGE_PIN_DURATION_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const powerSchema = z.discriminatedUnion("power", [
  z.object({
    power:     z.literal("message_pin"),
    messageId: z.string().uuid("messageId must be a valid UUID"),
  }),
  z.object({
    power:         z.literal("room_spotlight"),
    durationHours: z.number().int().min(1).max(72).default(24),
  }),
  z.object({
    power:           z.literal("member_highlight"),
    targetUserId:    z.string().uuid("targetUserId must be a valid UUID"),
    durationMinutes: z.number().int().min(30).max(480).default(60),
  }),
]);

// ---------------------------------------------------------------------------
// Route params
// ---------------------------------------------------------------------------

interface RoomParams {
  roomId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// POST /api/rooms/[roomId]/powers
// ---------------------------------------------------------------------------

export const POST = withAuth<RoomParams>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { roomId } = params;
    if (!UUID_RE.test(roomId)) throw badRequest("roomId must be a valid UUID");

    const body = await validateBody(req, powerSchema);
    const userId = auth.user.sub;
    const coinCost = POWER_COSTS[body.power];

    const orm = await getDb();
    const result = await orm.transaction(async (tx) => {
      // 1. Verify room exists and monetization is enabled
      // NOTE: rooms.monetization_disabled exists in the real table
      // (db/migrations/0001_consolidated_schema.sql) but is missing from the
      // Drizzle schema (lib/db/schema.ts) — a genuine schema gap. Selected
      // via a raw `sql` fragment until that column is added to schema.ts.
      const [room] = await tx
        .select({
          id: schema.rooms.id,
          creator_id: schema.rooms.creatorId,
          is_active: schema.rooms.isActive,
          is_suspended: sql<boolean>`COALESCE(${schema.rooms.isSuspended}, FALSE)`,
          monetization_disabled: sql<boolean>`COALESCE(monetization_disabled, FALSE)`,
        })
        .from(schema.rooms)
        .where(and(eq(schema.rooms.id, roomId), isNull(schema.rooms.deletedAt)))
        .limit(1);
      if (!room) throw notFound("Room not found");
      if (!room.is_active) throw badRequest("Room is no longer active");
      if (room.is_suspended) throw badRequest("Room is currently suspended");
      if (room.monetization_disabled) throw badRequest("Monetization has been disabled for this room");

      // 2. For message_pin, check permissions before touching the coin balance.
      //    This avoids a confusing 403 response after coins were already locked.
      if (body.power === "message_pin" && room.creator_id !== userId) {
        const [modRow] = await tx
          .select({ id: schema.roomMembers.id })
          .from(schema.roomMembers)
          .where(
            and(
              eq(schema.roomMembers.roomId, roomId),
              eq(schema.roomMembers.userId, userId),
              eq(schema.roomMembers.role, "co_moderator")
            )
          )
          .limit(1);
        if (!modRow) {
          throw forbidden("Only room creators and moderators can pin messages");
        }
      }

      // 3. Check caller has enough coins — lock the row
      const [user] = await tx
        .select({ coin_balance: schema.users.coinBalance })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .for("update");
      if (!user) throw notFound("User not found");
      const coinBalance = Number(user.coin_balance);
      if (coinBalance < coinCost) {
        throw badRequest(`Insufficient coins. This power costs ${coinCost} Coins.`);
      }

      // 4. Deduct coins — build a unique reference_id per distinct operation so
      //    retries are idempotent and different operations on the same room never
      //    collide on the (user_id, transaction_type, reference_id) unique index.
      let referenceId: string;
      if (body.power === "message_pin") {
        referenceId = `message_pin:${body.messageId}`;
      } else if (body.power === "room_spotlight") {
        const spotlightUntil = new Date(Date.now() + body.durationHours * 60 * 60 * 1000).toISOString();
        referenceId = `room_spotlight:${roomId}:${spotlightUntil}`;
      } else {
        const expiresAt = new Date(Date.now() + (body as { durationMinutes: number }).durationMinutes * 60 * 1000).toISOString();
        referenceId = `member_highlight:${roomId}:${(body as { targetUserId: string }).targetUserId}:${expiresAt}`;
      }

      const newBalance = coinBalance - coinCost;
      await tx
        .update(schema.users)
        .set({ coinBalance: BigInt(newBalance), updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
      await tx
        .insert(schema.coinLedger)
        .values({
          userId,
          amount: BigInt(-coinCost),
          balanceBefore: BigInt(coinBalance),
          balanceAfter: BigInt(newBalance),
          transactionType: "room_power",
          referenceId,
        })
        .onConflictDoNothing();

      // 5. Apply power
      if (body.power === "message_pin") {

        const pinExpiresAt = new Date(Date.now() + MESSAGE_PIN_DURATION_MS);

        await tx
          .update(schema.roomMessages)
          .set({ isPinned: true, pinnedAt: new Date(), pinnedBy: userId, pinExpiresAt })
          .where(and(eq(schema.roomMessages.id, body.messageId), eq(schema.roomMessages.roomId, roomId)));

        return { power: "message_pin", messageId: body.messageId, pinExpiresAt: pinExpiresAt.toISOString(), coinsSpent: coinCost };

      } else if (body.power === "room_spotlight") {
        const durationMs = body.durationHours * 60 * 60 * 1000;
        const spotlightUntil = new Date(Date.now() + durationMs);

        await tx
          .update(schema.rooms)
          .set({
            spotlightUntil: sql`GREATEST(COALESCE(${schema.rooms.spotlightUntil}, NOW()), ${spotlightUntil.toISOString()}::timestamptz)`,
            spotlightBy: userId,
            updatedAt: new Date(),
          })
          .where(eq(schema.rooms.id, roomId));

        return { power: "room_spotlight", spotlightUntil: spotlightUntil.toISOString(), durationHours: body.durationHours, coinsSpent: coinCost };

      } else if (body.power === "member_highlight") {
        const durationMs = body.durationMinutes * 60 * 1000;
        const expiresAt = new Date(Date.now() + durationMs);

        await tx
          .insert(schema.roomMemberHighlights)
          .values({ roomId, userId: body.targetUserId, highlightedBy: userId, expiresAt })
          .onConflictDoUpdate({
            target: [schema.roomMemberHighlights.roomId, schema.roomMemberHighlights.userId],
            set: {
              expiresAt: sql`GREATEST(${schema.roomMemberHighlights.expiresAt}, EXCLUDED.expires_at)`,
              highlightedBy: sql`EXCLUDED.highlighted_by`,
            },
          });

        return { power: "member_highlight", targetUserId: body.targetUserId, expiresAt: expiresAt.toISOString(), coinsSpent: coinCost };
      }

      throw badRequest("Unknown power type");
    });

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
