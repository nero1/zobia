export const dynamic = 'force-dynamic';

/**
 * app/api/creator/broadcasts/route.ts
 *
 * GET  /api/creator/broadcasts  — fetch allowance + history
 * POST /api/creator/broadcasts  — send a broadcast to all followers
 *
 * Tier-based limits per PRD:
 *  - Verified tier : 3 free broadcasts per month; ₦200/send thereafter
 *  - Rising tier   : Pay-per-send at ₦200/send
 *  - Elite / Icon  : Unlimited free broadcasts
 *
 * Messages are bulk-inserted into `creator_broadcasts` for each follower.
 * Telegram cross-delivery is triggered if the follower has telegram_id set.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import {
  handleApiError,
  forbidden,
  badRequest,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { logger } from "@/lib/logger";

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
  const orm = await getDb();
  const [row] = await orm
    .select({ cnt: sql<string>`COUNT(*)::text` })
    .from(schema.creatorBroadcasts)
    .where(
      and(
        eq(schema.creatorBroadcasts.creatorId, creatorId),
        sql`${schema.creatorBroadcasts.createdAt} >= DATE_TRUNC('month', NOW())`
      )
    );
  return parseInt(row?.cnt ?? "0", 10);
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
  const orm = await getDb();
  const rows = await orm
    .select({ user_id: schema.follows.followerId, telegram_id: schema.users.telegramId })
    .from(schema.follows)
    .innerJoin(schema.users, eq(schema.users.id, schema.follows.followerId))
    .where(and(eq(schema.follows.followingId, creatorId), isNull(schema.users.deletedAt)));
  return rows;
}

// ---------------------------------------------------------------------------
// GET /api/creator/broadcasts
// ---------------------------------------------------------------------------

interface BroadcastRow {
  id: string;
  subject: string | null;
  content: string;
  created_at: string;
  recipient_count: number;
}

/**
 * Fetch the creator's broadcast allowance and send history.
 */
export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const creatorId = auth.user.sub;

    const orm = await getDb();
    const [creatorRow] = await orm
      .select({ is_creator: schema.users.isCreator, creator_tier: schema.users.creatorTier, coin_balance: schema.users.coinBalance })
      .from(schema.users)
      .where(and(eq(schema.users.id, creatorId), isNull(schema.users.deletedAt)))
      .limit(1);
    const creator: CreatorRow | undefined = creatorRow
      ? { is_creator: creatorRow.is_creator, creator_tier: creatorRow.creator_tier, coin_balance: Number(creatorRow.coin_balance) }
      : undefined;

    if (!creator?.is_creator) {
      return NextResponse.json(
        { message: "Creator account required", reason: "not_creator" },
        { status: 403 }
      );
    }

    const tier = creator.creator_tier ?? "rookie";
    const isAllowed = ALLOWED_TIERS.includes(tier as (typeof ALLOWED_TIERS)[number]);

    if (!isAllowed) {
      return NextResponse.json(
        {
          message: "Rising tier or above required to send broadcasts",
          reason: "tier_too_low",
        },
        { status: 403 }
      );
    }

    const isUnlimited = UNLIMITED_BROADCAST_TIERS.includes(
      tier as (typeof UNLIMITED_BROADCAST_TIERS)[number]
    );

    const monthlyCount = await countMonthlyBroadcasts(creatorId);

    let freeRemaining = 0;
    let freeTotal = 0;
    let canSend = true;
    let reason: string | undefined;

    if (isUnlimited) {
      freeRemaining = Infinity;
      freeTotal = Infinity;
    } else if (tier === "verified") {
      freeTotal = VERIFIED_FREE_QUOTA;
      freeRemaining = Math.max(0, VERIFIED_FREE_QUOTA - monthlyCount);
    } else if (tier === "rising") {
      freeTotal = 0;
      freeRemaining = 0;
      if (monthlyCount >= RISING_MONTHLY_CAP) {
        canSend = false;
        reason = `Monthly cap of ${RISING_MONTHLY_CAP} reached`;
      }
    }

    const allowance = {
      tier,
      freeRemaining: isUnlimited ? 999 : freeRemaining,
      freeTotal: isUnlimited ? 999 : freeTotal,
      additionalCoinCost: BROADCAST_COST_COINS,
      canSend,
      reason,
    };

    const historyRows = await orm
      .select({
        id: schema.creatorBroadcasts.id,
        subject: schema.creatorBroadcasts.subject,
        content: schema.creatorBroadcasts.content,
        created_at: schema.creatorBroadcasts.createdAt,
        recipient_count: schema.creatorBroadcasts.recipientCount,
      })
      .from(schema.creatorBroadcasts)
      .where(eq(schema.creatorBroadcasts.creatorId, creatorId))
      .orderBy(desc(schema.creatorBroadcasts.createdAt))
      .limit(50);

    const broadcasts = historyRows.map((r) => ({
      id: r.id,
      subject: r.subject ?? "",
      body: r.content,
      sentAt: r.created_at,
      recipientCount: r.recipient_count,
    }));

    return NextResponse.json({ allowance, broadcasts });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/creator/broadcasts
// ---------------------------------------------------------------------------

/**
 * Send a broadcast message to all followers.
 *
 * @param req - Incoming request with broadcast payload
 * @returns Broadcast record with recipient count
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const creatorId = auth.user.sub;
    const body = await validateBody(req, broadcastSchema);

    // Fetch creator data
    const orm = await getDb();
    const [creatorRow] = await orm
      .select({ is_creator: schema.users.isCreator, creator_tier: schema.users.creatorTier, coin_balance: schema.users.coinBalance })
      .from(schema.users)
      .where(and(eq(schema.users.id, creatorId), isNull(schema.users.deletedAt)))
      .limit(1);
    const creator: CreatorRow | undefined = creatorRow
      ? { is_creator: creatorRow.is_creator, creator_tier: creatorRow.creator_tier, coin_balance: Number(creatorRow.coin_balance) }
      : undefined;

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
    const broadcast = await orm.transaction(async (tx) => {
      // Deduct coins if applicable
      if (costCoins > 0) {
        const [balRow] = await tx
          .select({ coin_balance: schema.users.coinBalance })
          .from(schema.users)
          .where(eq(schema.users.id, creatorId))
          .for("update");
        const balanceBefore = Number(balRow?.coin_balance ?? 0);

        await tx
          .update(schema.users)
          .set({ coinBalance: sql`${schema.users.coinBalance} - ${costCoins}`, updatedAt: new Date() })
          .where(eq(schema.users.id, creatorId));

        await tx.insert(schema.coinLedger).values({
          userId: creatorId,
          amount: BigInt(-costCoins),
          balanceBefore: BigInt(balanceBefore),
          balanceAfter: BigInt(balanceBefore - costCoins),
          transactionType: "subscription",
          description: "Broadcast message fee",
        });
      }

      // Create broadcast record
      const [broadcastRecord] = await tx
        .insert(schema.creatorBroadcasts)
        .values({
          creatorId,
          subject: body.subject ?? null,
          content: body.content,
          recipientCount,
          costCoins,
        })
        .returning();

      if (!broadcastRecord) throw new Error("Broadcast creation failed");

      // Bulk insert creator_broadcasts for each follower
      const userIds = followers.map((f) => f.user_id);
      if (userIds.length > 0) {
        await tx.insert(schema.creatorBroadcasts).values(
          userIds.map((userId) => ({
            senderId: creatorId,
            recipientId: userId,
            content: body.content,
            messageType: "broadcast",
            referenceId: broadcastRecord.id,
          }))
        );
      }

      return broadcastRecord;
    });

    // Telegram cross-delivery (fire-and-forget, non-blocking)
    const telegramFollowers = followers.filter((f) => f.telegram_id);
    if (telegramFollowers.length > 0) {
      // Enqueue Telegram delivery — the cron/queue worker picks this up
      void orm
        .insert(schema.telegramDeliveryQueue)
        .values({
          broadcastId: broadcast.id,
          telegramIds: telegramFollowers.map((f) => f.telegram_id),
        })
        .catch((err) => {
          logger.error({ err: err }, "[broadcasts] Telegram queue enqueue failed:");
          });
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
