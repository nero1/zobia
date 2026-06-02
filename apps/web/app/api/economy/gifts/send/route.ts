/**
 * POST /api/economy/gifts/send
 *
 * Send a gift to another user, optionally in a Room context.
 *
 * Flow:
 *   1. Validate the gift item and recipient exist
 *   2. Atomically deduct coins from sender (fails if insufficient balance)
 *   3. Create a gift record and a chat message (or room message)
 *   4. Check if gift value exceeds creator's spectacle threshold (rooms only)
 *   5. Award XP to both sender (Generosity) and recipient
 *
 * @module app/api/economy/gifts/send
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { debitCoins } from "@/lib/economy/coins";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const SendGiftSchema = z.object({
  /** UUID of the gift item from the catalogue. */
  giftItemId: z.string().uuid("giftItemId must be a valid UUID"),
  /** UUID of the recipient user. */
  recipientId: z.string().uuid("recipientId must be a valid UUID"),
  /** Optional Room UUID — if provided, the gift appears in the room feed. */
  roomId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface GiftItemRow {
  id: string;
  name: string;
  emoji: string;
  coin_cost: number;
  tier: number;
  spectacle_threshold_coins: number | null;
}

interface UserRow {
  id: string;
  username: string;
}

// ---------------------------------------------------------------------------
// XP awards (fire-and-forget)
// ---------------------------------------------------------------------------

async function awardGiftXP(
  senderId: string,
  recipientId: string,
  giftTier: number
): Promise<void> {
  try {
    // Sender gets Generosity XP — scales with tier
    const senderXP = 10 * giftTier;
    // Recipient gets Social XP — fixed
    const recipientXP = 5;

    await Promise.all([
      db.query(
        `INSERT INTO xp_events (user_id, action, xp_awarded, track, metadata)
         VALUES ($1, 'gift_sent', $2, 'generosity', $3::jsonb)`,
        [senderId, senderXP, JSON.stringify({ recipientId, giftTier })]
      ),
      db.query(
        `INSERT INTO xp_events (user_id, action, xp_awarded, track, metadata)
         VALUES ($1, 'receive_gift_and_react', $2, 'social', $3::jsonb)`,
        [recipientId, recipientXP, JSON.stringify({ senderId, giftTier })]
      ),
    ]);

    await db.query(
      `UPDATE users SET xp_total = xp_total + $2, updated_at = NOW() WHERE id = $1`,
      [senderId, senderXP]
    );
    await db.query(
      `UPDATE users SET xp_total = xp_total + $2, updated_at = NOW() WHERE id = $1`,
      [recipientId, recipientXP]
    );
  } catch (err) {
    console.error("[gifts/send] Failed to award XP:", err);
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/economy/gifts/send
 *
 * Body: { giftItemId: string, recipientId: string, roomId?: string }
 * Returns: { giftId, spectacleTriggered }
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const body = await validateBody(req, SendGiftSchema);
    const senderId = auth.user.sub;

    if (body.recipientId === senderId) {
      throw badRequest("Cannot send a gift to yourself");
    }

    // 1. Load gift item
    const { rows: giftRows } = await db.query<GiftItemRow>(
      `SELECT id, name, emoji, coin_cost, tier, spectacle_threshold_coins
       FROM gift_items
       WHERE id = $1 AND is_active = TRUE
       LIMIT 1`,
      [body.giftItemId]
    );

    if (!giftRows[0]) {
      throw notFound("Gift item not found or unavailable");
    }

    const giftItem = giftRows[0];

    // 2. Verify recipient exists
    const { rows: recipientRows } = await db.query<UserRow>(
      `SELECT id, username FROM users
       WHERE id = $1 AND deleted_at IS NULL AND is_banned = FALSE
       LIMIT 1`,
      [body.recipientId]
    );

    if (!recipientRows[0]) {
      throw notFound("Recipient not found");
    }

    const recipient = recipientRows[0];

    // 3. Atomic: debit coins and create gift record
    let giftId: string;
    let spectacleTriggered = false;

    await db.transaction(async (tx) => {
      // Debit coins from sender
      await debitCoins(
        senderId,
        giftItem.coin_cost,
        "gift_sent",
        null,
        `Sent ${giftItem.emoji} ${giftItem.name} to @${recipient.username}`,
        { recipientId: body.recipientId, giftItemId: giftItem.id },
        tx
      );

      // Create the gift record
      const { rows: giftInsert } = await tx.query<{ id: string }>(
        `INSERT INTO gifts
           (sender_id, recipient_id, gift_item_id, coin_cost, room_id, status)
         VALUES ($1, $2, $3, $4, $5, 'delivered')
         RETURNING id`,
        [
          senderId,
          body.recipientId,
          giftItem.id,
          giftItem.coin_cost,
          body.roomId ?? null,
        ]
      );

      giftId = giftInsert[0].id;

      // Create the message/event in the appropriate context
      if (body.roomId) {
        await tx.query(
          `INSERT INTO room_messages
             (room_id, user_id, content_type, content, metadata)
           VALUES ($1, $2, 'gift', $3, $4::jsonb)`,
          [
            body.roomId,
            senderId,
            `${giftItem.emoji} ${giftItem.name}`,
            JSON.stringify({
              giftId,
              giftItemId: giftItem.id,
              recipientId: body.recipientId,
              coinCost: giftItem.coin_cost,
              tier: giftItem.tier,
            }),
          ]
        );

        // Check spectacle threshold
        if (
          giftItem.spectacle_threshold_coins != null &&
          giftItem.coin_cost >= giftItem.spectacle_threshold_coins
        ) {
          spectacleTriggered = true;
        }
      } else {
        // DM gift message
        await tx.query(
          `INSERT INTO messages
             (sender_id, recipient_id, content_type, content, metadata)
           VALUES ($1, $2, 'gift', $3, $4::jsonb)`,
          [
            senderId,
            body.recipientId,
            `${giftItem.emoji} ${giftItem.name}`,
            JSON.stringify({
              giftId,
              giftItemId: giftItem.id,
              coinCost: giftItem.coin_cost,
              tier: giftItem.tier,
            }),
          ]
        );
      }
    });

    // 4. Award XP (fire-and-forget)
    void awardGiftXP(senderId, body.recipientId, giftItem.tier);

    return NextResponse.json({
      success: true,
      giftId: giftId!,
      gift: {
        id: giftItem.id,
        name: giftItem.name,
        emoji: giftItem.emoji,
        tier: giftItem.tier,
        coinCost: giftItem.coin_cost,
      },
      recipient: {
        id: recipient.id,
        username: recipient.username,
      },
      spectacleTriggered,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "INSUFFICIENT_BALANCE") {
      return handleApiError(
        badRequest("Not enough coins to send this gift", "INSUFFICIENT_BALANCE")
      );
    }
    return handleApiError(err);
  }
});
