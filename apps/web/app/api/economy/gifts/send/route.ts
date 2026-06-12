export const dynamic = 'force-dynamic';

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
import { badRequest, notFound, forbidden, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { debitCoins, creditCoins } from "@/lib/economy/coins";
import { meetsMinimumTrust } from "@/lib/trust/trustScore";
import { recordWarContribution } from "@/lib/guilds/recordWarContribution";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { redis } from "@/lib/redis";

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
  /** Optional idempotency key — prevents double-send on client retry. */
  idempotencyKey: z.string().uuid("idempotencyKey must be a valid UUID").optional(),
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
  creator_tier: string | null;
}

// ---------------------------------------------------------------------------
// XP awards (fire-and-forget)
// ---------------------------------------------------------------------------

async function awardGiftXP(
  senderId: string,
  recipientId: string,
  giftTier: number,
  roomId?: string | null
): Promise<void> {
  try {
    // PRD §6: Sending a gift message awards fixed 10 XP (not tier-scaled)
    const senderXP = 10;
    // Recipient gets Social XP — fixed 5
    const recipientXP = 5;

    // PRD §6: Check if recipient has ever received a gift before (first_time_gifted = 15 XP)
    const { rows: prevGiftRows } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM gifts WHERE recipient_id = $1 LIMIT 1`,
      [recipientId]
    );
    const isFirstGift = parseInt(prevGiftRows[0]?.count ?? "0") <= 1; // <= 1 because the new gift is already inserted

    // PRD §6: being_tipped_in_room = 25 XP for creator when gift is sent in a room
    const isTippedInRoom = !!roomId;

    const xpEvents = [
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
    ];

    if (isFirstGift) {
      xpEvents.push(
        db.query(
          `INSERT INTO xp_events (user_id, action, xp_awarded, track, metadata)
           VALUES ($1, 'first_time_gifted', 15, 'social', $2::jsonb)`,
          [recipientId, JSON.stringify({ senderId, giftTier })]
        )
      );
    }

    if (isTippedInRoom) {
      xpEvents.push(
        db.query(
          `INSERT INTO xp_events (user_id, action, xp_awarded, track, metadata)
           VALUES ($1, 'being_tipped_in_room', 25, 'creator', $2::jsonb)`,
          [recipientId, JSON.stringify({ senderId, roomId, giftTier })]
        )
      );
    }

    await Promise.all(xpEvents);

    const userUpdates = [
      db.query(
        `UPDATE users SET xp_total = xp_total + $2, xp_generosity = xp_generosity + $2, updated_at = NOW() WHERE id = $1`,
        [senderId, senderXP]
      ),
      db.query(
        `UPDATE users SET xp_total = xp_total + $2, xp_social = xp_social + $2, updated_at = NOW() WHERE id = $1`,
        [recipientId, recipientXP]
      ),
    ];

    if (isFirstGift) {
      userUpdates.push(
        db.query(
          `UPDATE users SET xp_total = xp_total + 15, xp_social = xp_social + 15, updated_at = NOW() WHERE id = $1`,
          [recipientId]
        )
      );
    }

    if (isTippedInRoom) {
      userUpdates.push(
        db.query(
          `UPDATE users SET xp_total = xp_total + 25, xp_creator = xp_creator + 25, updated_at = NOW() WHERE id = $1`,
          [recipientId]
        )
      );
    }

    await Promise.all(userUpdates);
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
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  // Declared outside try so the catch block can clean it up on error
  let idempKey: string | null = null;
  try {
    const body = await validateBody(req, SendGiftSchema);
    const senderId = auth.user.sub;

    // Rate-limit: prevent double-tap sends (#13)
    await enforceRateLimit(senderId, "user", RATE_LIMITS.apiWrite);

    if (body.recipientId === senderId) {
      throw badRequest("Cannot send a gift to yourself");
    }

    // Idempotency guard via atomic SET NX (#13)
    if (body.idempotencyKey) {
      idempKey = `idempotency:gift:${senderId}:${body.idempotencyKey}`;
      const setResult = await redis.set(idempKey, "processing", "EX", 86400, "NX");
      if (setResult === null) {
        return NextResponse.json({ success: true, duplicate: true, message: "Duplicate request - gift already sent" });
      }
    }

    // Trust gate: send_gift requires minimum trust score of 20
    const trusted = await meetsMinimumTrust(senderId, "send_gift", db);
    if (!trusted) {
      throw forbidden("Your account trust score is too low to send gifts. Build your reputation first.", "TRUST_SCORE_TOO_LOW");
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
      `SELECT id, username, COALESCE(is_creator, false) AS is_creator, creator_tier
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
    let giftId = "";
    let spectacleTriggered = false;

    // Compute fee split — Icon creators get 85% (15% fee), other creators 80% (20% fee), users 95% (5% fee)
    const creatorFeePercent = recipient.creator_tier === 'icon' ? 15 : CREATOR_GIFT_FEE_PERCENT;
    const feePercent = recipient.is_creator ? creatorFeePercent : USER_GIFT_FEE_PERCENT;
    const platformFeeCoins = Math.floor((giftItem.coin_cost * feePercent) / 100);
    const recipientCoins = giftItem.coin_cost - platformFeeCoins;

    await db.transaction(async (tx) => {
      // Debit full coin cost from sender — on failure the catch below cleans up idempKey
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

      // Gifts are virtual-coin denominated, not fiat (kobo). We do NOT insert into
      // creator_earnings here because those columns are real-money (kobo) fields and
      // mixing coin values there would corrupt payout accounting (#14).
      // The coin_ledger entries written above are the canonical accounting record.
      // If gift-to-fiat cashout is needed in future, apply an explicit coin→kobo
      // conversion rate at withdrawal time.

      // Guild Legend tier 5% Room Revenue Share (PRD §13)
      // If this gift is in a room and the room creator belongs to a Legend-tier guild,
      // credit 5% of the gift's coin value to that guild's treasury.
      if (body.roomId && recipient.is_creator) {
        try {
          const { rows: legendGuildRows } = await tx.query<{ guild_id: string; treasury_balance: number }>(
            `SELECT g.id AS guild_id, g.treasury_balance
             FROM guilds g
             JOIN guild_members gm ON gm.guild_id = g.id
             WHERE gm.user_id = $1
               AND g.tier = 'legend'
               AND g.deleted_at IS NULL
             LIMIT 1`,
            [body.recipientId]
          );
          if (legendGuildRows[0]) {
            const guildShare = Math.floor(giftItem.coin_cost * 5 / 100);
            if (guildShare > 0) {
              const balanceBefore = legendGuildRows[0].treasury_balance ?? 0;
              // LEAST clamp ensures treasury_balance never exceeds treasury_cap (#24)
              const { rows: updatedGuild } = await tx.query<{ treasury_balance: number }>(
                `UPDATE guilds
                 SET treasury_balance = LEAST(treasury_cap, COALESCE(treasury_balance, 0) + $1),
                     updated_at = NOW()
                 WHERE id = $2
                 RETURNING treasury_balance`,
                [guildShare, legendGuildRows[0].guild_id]
              );
              const balanceAfter = updatedGuild[0]?.treasury_balance ?? balanceBefore;
              await tx.query(
                `INSERT INTO guild_treasury_ledger
                   (guild_id, amount, balance_before, balance_after, transaction_type, reference_id, created_at)
                 VALUES ($1, $2, $3, $4, 'room_revenue_share', $5, NOW())`,
                [legendGuildRows[0].guild_id, guildShare, balanceBefore, balanceAfter, body.roomId ?? null]
              );
            }
          }
        } catch {
          // Non-fatal — guild revenue share is a best-effort bonus
        }
      }

      // Create the gift record (coin_value is the original NOT NULL column; coin_cost is its alias)
      const { rows: giftInsert } = await tx.query<{ id: string }>(
        `INSERT INTO gifts
           (sender_id, recipient_id, gift_item_id, coin_value, coin_cost, room_id, status)
         VALUES ($1, $2, $3, $4, $4, $5, 'delivered')
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
             (room_id, sender_id, message_type, content, metadata)
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
           VALUES ($1, $2, $3, 'gift', $4, NULL, $5, 0)`,
          [
            senderId,
            body.recipientId,
            dmConversationId,
            `${giftItem.emoji} ${giftItem.name} (${giftItem.coin_cost} coins)`,
            giftItem.coin_cost,
          ]
        );
      }
    });

    // 4. Award XP (fire-and-forget)
    void awardGiftXP(senderId, body.recipientId, giftItem.tier, body.roomId);

    // 5. Record guild war contribution (fire-and-forget)
    recordWarContribution(senderId, 'send_gift', db).catch((err) =>
      console.error('[gifts:POST] war contribution failed', err)
    );

    return NextResponse.json({
      success: true,
      giftId,
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
    // On any error, remove the idempotency key so the client can retry
    if (idempKey) await redis.del(idempKey).catch(() => {});
    if ((err as NodeJS.ErrnoException).code === "INSUFFICIENT_BALANCE") {
      return handleApiError(
        badRequest("Not enough coins to send this gift", "INSUFFICIENT_BALANCE")
      );
    }
    return handleApiError(err);
  }
});
