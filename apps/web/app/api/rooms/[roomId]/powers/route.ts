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
import { db } from "@/lib/db";
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

    const result = await db.transaction(async (client) => {
      // 1. Verify room exists
      const { rows: roomRows } = await client.query<{
        id: string;
        creator_id: string;
        is_active: boolean;
      }>(
        `SELECT id, creator_id, is_active FROM rooms WHERE id = $1 AND deleted_at IS NULL`,
        [roomId]
      );
      const room = roomRows[0];
      if (!room) throw notFound("Room not found");
      if (!room.is_active) throw badRequest("Room is no longer active");

      // 2. Check caller has enough coins — lock the row
      const { rows: userRows } = await client.query<{
        coin_balance: number;
      }>(
        `SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE`,
        [userId]
      );
      const user = userRows[0];
      if (!user) throw notFound("User not found");
      if (user.coin_balance < coinCost) {
        throw badRequest(`Insufficient coins. This power costs ${coinCost} Coins.`);
      }

      // 3. Deduct coins
      const newBalance = user.coin_balance - coinCost;
      await client.query(
        `UPDATE users SET coin_balance = $1, updated_at = NOW() WHERE id = $2`,
        [newBalance, userId]
      );
      await client.query(
        `INSERT INTO coin_ledger (user_id, amount, type, reference, created_at)
         VALUES ($1, $2, 'room_power', $3, NOW())`,
        [userId, -coinCost, `${body.power}:${roomId}`]
      );

      // 4. Apply power
      if (body.power === "message_pin") {
        // Only room creator or co-mods can pin messages
        const { rows: modRows } = await client.query<{ id: string }>(
          `SELECT id FROM room_moderators WHERE room_id = $1 AND user_id = $2
           UNION
           SELECT id FROM rooms WHERE id = $1 AND creator_id = $2`,
          [roomId, userId]
        ).catch(() => ({ rows: [] as Array<{ id: string }> }));

        if (!modRows.length && room.creator_id !== userId) {
          throw forbidden("Only room creators and moderators can pin messages");
        }

        await client.query(
          `UPDATE room_messages
           SET is_pinned = true, pinned_at = NOW(), pinned_by = $1
           WHERE id = $2 AND room_id = $3`,
          [userId, body.messageId, roomId]
        );

        return { power: "message_pin", messageId: body.messageId, coinsSpent: coinCost };

      } else if (body.power === "room_spotlight") {
        const durationMs = body.durationHours * 60 * 60 * 1000;
        const spotlightUntil = new Date(Date.now() + durationMs).toISOString();

        await client.query(
          `UPDATE rooms
           SET spotlight_until = GREATEST(COALESCE(spotlight_until, NOW()), $1::timestamptz),
               spotlight_by = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [spotlightUntil, userId, roomId]
        );

        return { power: "room_spotlight", spotlightUntil, durationHours: body.durationHours, coinsSpent: coinCost };

      } else if (body.power === "member_highlight") {
        const durationMs = body.durationMinutes * 60 * 1000;
        const expiresAt = new Date(Date.now() + durationMs).toISOString();

        await client.query(
          `INSERT INTO room_member_highlights (room_id, user_id, highlighted_by, expires_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (room_id, user_id) DO UPDATE
           SET expires_at = GREATEST(room_member_highlights.expires_at, EXCLUDED.expires_at),
               highlighted_by = EXCLUDED.highlighted_by`,
          [roomId, body.targetUserId, userId, expiresAt]
        );

        return { power: "member_highlight", targetUserId: body.targetUserId, expiresAt, coinsSpent: coinCost };
      }

      throw badRequest("Unknown power type");
    });

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
