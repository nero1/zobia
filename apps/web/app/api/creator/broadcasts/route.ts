export const dynamic = 'force-dynamic';

/**
 * app/api/creator/broadcasts/route.ts
 *
 * POST /api/creator/broadcasts
 *
 * Send a broadcast message to all the creator's followers.
 *
 * Tier-based limits per PRD:
 *  - Verified tier : 3 free broadcasts per month; ₦200/send thereafter
 *  - Rising tier   : Pay-per-send at ₦200/send
 *  - Elite / Icon  : Unlimited free broadcasts
 *
 * Messages are bulk-inserted into `user_messages` for each follower.
 * Telegram cross-delivery is triggered if the follower has telegram_id set.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import {
  handleApiError,
  forbidden,
  badRequest,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Naira cost per broadcast for tiers that are not free. */
const BROADCAST_COST_NGN = 200;

/** Coins equivalent (1 NGN = 1 coin for simplicity). */
const BROADCAST_COST_COINS = 200;

/** Free broadcast quota for Verified tier per calendar month. */
const VERIFIED_FREE_QUOTA = 3;

/** Monthly cap for Rising tier (paid per send, max 3/month — PRD §14 Creator Tiers table). */
const RISING_MONTHLY_CAP = 3;

/** Tiers that get unlimited free broadcasts. */
const UNLIMITED_BROADCAST_TIERS = ["elite", "icon"] as const;

/** Minimum tier required to send broadcasts at all. */
const ALLOWED_TIERS = ["rising", "verified", "elite", "icon"] as const;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const broadcastSchema = z.object({
  subject: z.string().max(200).optional(),
  content: z
    .string()
    .min(1, "Broadcast content cannot be empty")
    .max(1000, "Broadcast content cannot exceed 1,000 characters"),
  /** When true, deduct the coin cost from balance for pay-per-send tiers. */
  confirmPayment: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface CreatorRow {
  is_creator: boolean;
  creator_tier: string | null;
  coin_balance: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count how many broadcasts the creator has sent in the current calendar month.
 *
 * @param creatorId - Creator UUID
 */
async function countMonthlyBroadcasts(creatorId: string): Promise<number> {
  const { rows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM creator_broadcasts
     WHERE creator_id = $1
       AND created_at >= DATE_TRUNC('month', NOW())`,
    [creatorId]
  );
  return parseInt(rows[0]?.cnt ?? "0", 10);
}

/**
 * Fetch all follower user IDs + telegram IDs for a creator.
 *
 * @param creatorId - Creator UUID
 * @returns Array of { user_id, telegram_id } objects
 */
async function fetchFollowers(
  creatorId: string
): Promise<Array<{ user_id: string; telegram_id: string | null }>> {
  const { rows } = await db.query<{ user_id: string; telegram_id: string | null }>(
    `SELECT uf.follower_id AS user_id, u.telegram_id
     FROM follows uf
     JOIN users u ON u.id = uf.follower_id
     WHERE uf.following_id = $1
       AND u.deleted_at IS NULL`,
    [creatorId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// POST /api/creator/broadcasts
// ---------------------------------------------------------------------------

/**
 * Send a broadcast message to all followers.
 *
 * @param req - Incoming request with broadcast payload
 * @returns Broadcast record with recipient count
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const creatorId = auth.user.sub;
    const body = await validateBody(req, broadcastSchema);

    // Fetch creator data
    const { rows: creatorRows } = await db.query<CreatorRow>(
      `SELECT is_creator, creator_tier, coin_balance
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [creatorId]
    );
    const creator = creatorRows[0];

    if (!creator?.is_creator) {
      throw forbidden("Creator account required to send broadcasts");
    }

    const tier = creator.creator_tier ?? "rookie";

    // Tier eligibility check
    if (!ALLOWED_TIERS.includes(tier as (typeof ALLOWED_TIERS)[number])) {
      throw forbidden(
        "You must be at Rising tier or above to send broadcasts"
      );
    }

    // Determine cost
    const isUnlimited = UNLIMITED_BROADCAST_TIERS.includes(
      tier as (typeof UNLIMITED_BROADCAST_TIERS)[number]
    );
    let costCoins = 0;

    if (!isUnlimited) {
      if (tier === "verified") {
        const monthlyCount = await countMonthlyBroadcasts(creatorId);
        if (monthlyCount < VERIFIED_FREE_QUOTA) {
          // Free quota not exhausted — no cost
          costCoins = 0;
        } else {
          costCoins = BROADCAST_COST_COINS;
        }
      } else if (tier === "rising") {
        // Rising tier: 3/month hard cap (paid per send — PRD §14)
        const monthlyCount = await countMonthlyBroadcasts(creatorId);
        if (monthlyCount >= RISING_MONTHLY_CAP) {
          throw forbidden(
            `Rising tier creators can send a maximum of ${RISING_MONTHLY_CAP} broadcasts per month. ` +
              `Upgrade to Verified tier to unlock more.`
          );
        }
        costCoins = BROADCAST_COST_COINS;
      } else {
        // Any other allowed tier not explicitly handled: pay per send
        costCoins = BROADCAST_COST_COINS;
      }
    }

    if (costCoins > 0) {
      if (!body.confirmPayment) {
        // Inform client of the cost before proceeding
        return NextResponse.json(
          {
            requiresConfirmation: true,
            costCoins,
            costNgn: BROADCAST_COST_NGN,
            message: `Sending this broadcast costs ${costCoins} coins (₦${BROADCAST_COST_NGN}). Pass confirmPayment=true to proceed.`,
          },
          { status: 200 }
        );
      }

      if (creator.coin_balance < costCoins) {
        throw forbidden(
          `Insufficient balance. You need ${costCoins} coins to send this broadcast.`
        );
      }
    }

    // Fetch followers
    const followers = await fetchFollowers(creatorId);
    const recipientCount = followers.length;

    if (recipientCount === 0) {
      throw badRequest("You have no followers to broadcast to");
    }

    // Execute in transaction
    const broadcast = await db.transaction(async (tx) => {
      // Deduct coins if applicable
      if (costCoins > 0) {
        const { rows: balRows } = await tx.query<{ coin_balance: number }>(
          `SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE`,
          [creatorId]
        );
        const balanceBefore = balRows[0]?.coin_balance ?? 0;

        await tx.query(
          `UPDATE users
           SET coin_balance = coin_balance - $1, updated_at = NOW()
           WHERE id = $2`,
          [costCoins, creatorId]
        );

        await tx.query(
          `INSERT INTO coin_ledger
             (user_id, amount, balance_before, balance_after, transaction_type, description)
           VALUES ($1, $2, $3, $4, 'subscription', 'Broadcast message fee')`,
          [
            creatorId,
            -costCoins,
            balanceBefore,
            balanceBefore - costCoins,
          ]
        );
      }

      // Create broadcast record
      const { rows: broadcastRows } = await tx.query<{ id: string }>(
        `INSERT INTO creator_broadcasts
           (creator_id, subject, content, recipient_count, cost_coins)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          creatorId,
          body.subject ?? null,
          body.content,
          recipientCount,
          costCoins,
        ]
      );

      const broadcastRecord = broadcastRows[0];
      if (!broadcastRecord) throw new Error("Broadcast creation failed");

      // Bulk insert user_messages for each follower
      // Using unnest for performance on large follower lists
      const userIds = followers.map((f) => f.user_id);

      await tx.query(
        `INSERT INTO user_messages
           (sender_id, recipient_id, content, message_type, reference_id)
         SELECT $1, u, $2, 'broadcast', $3
         FROM UNNEST($4::uuid[]) AS u`,
        [creatorId, body.content, broadcastRecord.id, userIds]
      );

      return broadcastRecord;
    });

    // Telegram cross-delivery (fire-and-forget, non-blocking)
    const telegramFollowers = followers.filter((f) => f.telegram_id);
    if (telegramFollowers.length > 0) {
      // Enqueue Telegram delivery — the cron/queue worker picks this up
      void db
        .query(
          `INSERT INTO telegram_delivery_queue
             (broadcast_id, telegram_ids)
           VALUES ($1, $2)`,
          [
            broadcast.id,
            JSON.stringify(telegramFollowers.map((f) => f.telegram_id)),
          ]
        )
        .catch((err) =>
          console.error("[broadcasts] Telegram queue enqueue failed:", err)
        );
    }

    return NextResponse.json(
      {
        broadcast,
        recipientCount,
        costCoins,
        telegramDeliveryEnqueued: telegramFollowers.length > 0,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
