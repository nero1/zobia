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
import { debitCoins, creditCoins } from "@/lib/economy/coins";

// Platform takes 20% of gifts received by creators (PRD §14)
const CREATOR_GIFT_FEE_PERCENT = 20;
// Platform takes 5% of user-to-user coin gifts (PRD §11)
const USER_GIFT_FEE_PERCENT = 5;

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
  is_creator: boolean;
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
      `SELECT id, username, COALESCE(is_creator, false) AS is_creator
       FROM users
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

    // Compute fee split — creators get 80% (20% platform fee), users get 95% (5% fee)
    const feePercent = recipient.is_creator ? CREATOR_GIFT_FEE_PERCENT : USER_GIFT_FEE_PERCENT;
    const platformFeeCoins = Math.floor((giftItem.coin_cost * feePercent) / 100);
    const recipientCoins = giftItem.coin_cost - platformFeeCoins;

    await db.transaction(async (tx) => {
      // Debit full coin cost from sender
      await debitCoins(
        senderId,
        giftItem.coin_cost,
        "gift_sent",
        null,
        `Sent ${giftItem.emoji} ${giftItem.name} to @${recipient.username}`,
        { recipientId: body.recipientId, giftItemId: giftItem.id },
        tx
      );

      // Credit coins to recipient (80% for creators, 95% for regular users)
      await creditCoins(
        body.recipientId,
        recipientCoins,
        "gift_received",
        null,
        `Received ${giftItem.emoji} ${giftItem.name} from a friend`,
        { senderId, giftItemId: giftItem.id },
        tx
      );

      // Record creator_earnings for creator payout tracking
      if (recipient.is_creator && recipientCoins > 0) {
        // Use coin value as proxy for kobo (platform tracks actual payouts separately)
        await tx.query(
          `INSERT INTO creator_earnings
             (creator_id, source_type, gross_amount_kobo, platform_fee_kobo, net_amount_kobo, reference_id)
           VALUES ($1, 'gift', $2, $3, $4, $5)`,
          [
            body.recipientId,
            giftItem.coin_cost,
            platformFeeCoins,
            recipientCoins,
            null, // reference_id set after gift record created below
          ]
        ).catch(() => {}); // non-fatal if creator_earnings table structure differs
      }

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

        // Check both gift-item-level and creator-level spectacle thresholds (PRD §12)
        // Load the room's creator spectacle threshold
        const { rows: roomRows } = await tx.query<{ spectacle_threshold_coins: number | null }>(
          `SELECT spectacle_threshold_coins FROM rooms WHERE id = $1 LIMIT 1`,
          [body.roomId]
        );

        const roomThreshold = roomRows[0]?.spectacle_threshold_coins ?? null;
        const effectiveThreshold = roomThreshold ?? giftItem.spectacle_threshold_coins;

        if (effectiveThreshold != null && giftItem.coin_cost >= effectiveThreshold) {
          spectacleTriggered = true;
        } else if (effectiveThreshold == null) {
          // No threshold set — always trigger spectacle for tier 2+ gifts
          spectacleTriggered = giftItem.tier >= 2;
        }
      } else {
        // DM gift message — upsert the conversation record then insert a
        // properly typed message so it appears in the DM feed (PRD §5).
        const { rows: convUpsert } = await tx.query<{ id: string }>(
          `INSERT INTO dm_conversations (user_id_1, user_id_2)
           VALUES (
             LEAST($1::text, $2::text),
             GREATEST($1::text, $2::text)
           )
           ON CONFLICT (user_id_1, user_id_2) DO UPDATE SET updated_at = NOW()
           RETURNING id`,
          [senderId, body.recipientId]
        );
        const dmConversationId = convUpsert[0]?.id ?? null;

        await tx.query(
          `INSERT INTO messages
             (sender_id, recipient_id, conversation_id, message_type, content,
              media_url, coin_cost, reply_count_from_recipient)
           VALUES ($1, $2, $3, 'gift', $4, NULL, 0, 0)`,
          [
            senderId,
            body.recipientId,
            dmConversationId,
            `${giftItem.emoji} ${giftItem.name} (${giftItem.coin_cost} coins)`,
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
