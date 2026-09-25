export const dynamic = 'force-dynamic';

/**
 * POST /api/economy/coins/transfer
 *
 * Transfers coins from the authenticated user to another user.
 *
 * Economics:
 *   - 5% platform fee deducted from the gross amount
 *   - Sender pays: amount (full)
 *   - Recipient receives: amount × 0.95 (floor)
 *   - Platform retains: the fee remainder (not credited to anyone)
 *
 * Awards XP:
 *   - Sender:    +10 XP (Generosity track) — "send_gift_message" action
 *   - Recipient: +5 XP (Social track) — "receive_gift_and_react" action
 *
 * @module app/api/economy/coins/transfer
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, forbidden, handleApiError } from "@/lib/api/errors";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { transferCoins } from "@/lib/economy/coins";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { redis } from "@/lib/redis";
import { requirePinVerified } from "@/lib/auth/pinGuard";
import { calculateFinalXP, PLAN_XP_MULTIPLIERS_BP } from "@/lib/xp/engine";
import type { Plan } from "@zobia/types";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const TransferSchema = z.object({
  /** UUID of the recipient user. */
  recipientId: z.string().uuid("recipientId must be a valid UUID"),
  /**
   * Gross coin amount to transfer.
   * Sender pays this full amount; recipient receives 95% after platform fee.
   */
  amount: z
    .number()
    .int("Amount must be an integer")
    .min(10, "Minimum transfer amount is 10 coins")
    .max(100_000, "Maximum single transfer is 100,000 coins"),
  idempotencyKey: z.string().uuid("idempotencyKey must be a valid UUID").optional(),
});

// ---------------------------------------------------------------------------
// XP helpers (fire-and-forget after atomic coin transfer)
// ---------------------------------------------------------------------------

async function awardTransferXP(
  senderId: string,
  recipientId: string,
  transferIdempKey: string
): Promise<void> {
  try {
    // Fetch sender plan for multiplier (BUG-06: apply plan multiplier per PRD §6)
    const orm = await getDb();
    const [planRow] = await orm
      .select({ plan: schema.users.plan })
      .from(schema.users)
      .where(and(eq(schema.users.id, senderId), isNull(schema.users.deletedAt)))
      .limit(1);
    const senderPlan: Plan = (planRow?.plan as Plan) ?? 'free';

    // Sender: send_gift_message is a messaging action — apply plan multiplier per PRD §6
    const { finalXp: senderXP } = calculateFinalXP(
      'send_gift_message',
      { plan: senderPlan, isMessagingAction: true }
    );

    // Recipient: receive_gift_and_react is not a messaging action — no plan multiplier
    const { finalXp: recipientXP } = calculateFinalXP(
      'receive_gift_and_react',
      { plan: 'free', isMessagingAction: false }
    );

    // BUG-XP-20: use safeAwardXP with stable reference_ids derived from the transfer
    // idempotency key so retried calls never double-award and failures go to the DLQ.
    await Promise.all([
      safeAwardXP(senderId, senderXP, 'generosity', 'coin_transfer_sent', `${transferIdempKey}:sender`),
      safeAwardXP(recipientId, recipientXP, 'social', 'coin_transfer_received', `${transferIdempKey}:recipient`),
    ]);
  } catch (err) {
    // XP is best-effort — don't fail the transfer if XP recording fails
    logger.error({ err: err }, "[coins/transfer] Failed to award XP:");
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/economy/coins/transfer
 *
 * Body: { recipientId: string, amount: number }
 * Returns transfer details including fee breakdown and new balance.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  // Declared outside try so the catch block can clean it up on error
  let idempKey: string | null = null;
  try {
    const senderId = auth.user.sub;

    // Require a recent PIN verification before allowing coin transfers
    const pinOk = await requirePinVerified(senderId, auth.user.sid);
    if (!pinOk) {
      return NextResponse.json(
        { error: "PIN verification required", code: "PIN_REQUIRED" },
        { status: 403 }
      );
    }

    const body = await validateBody(req, TransferSchema);

    await enforceRateLimit(senderId, "user", RATE_LIMITS.apiWrite);

    // Prevent self-transfers
    if (body.recipientId === senderId) {
      throw badRequest("Cannot transfer coins to yourself");
    }

    // ZB-18: Derive the idempotency key server-side so it is always bound to the
    // specific operation (sender + recipient + amount). A client-only UUID can be
    // reused across different operations, allowing a different transfer to be silently
    // treated as a duplicate.
    const hourBucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
    const opHash = `${body.recipientId}:${body.amount}`;
    idempKey = body.idempotencyKey
      ? `idempotency:transfer:${senderId}:${body.idempotencyKey}:${opHash}`
      : `idempotency:transfer:${senderId}:${opHash}:${hourBucket}`;
    const setResult = await redis.set(idempKey, "processing", "EX", 86400, "NX");
    if (setResult === null) {
      // Key already exists — duplicate request
      return NextResponse.json({ success: true, duplicate: true, message: "Duplicate request - transfer already processed" });
    }

    // Verify the recipient exists
    const orm = await getDb();
    const [recipient] = await orm
      .select({ id: schema.users.id, username: schema.users.username })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, body.recipientId),
          isNull(schema.users.deletedAt),
          eq(sql`COALESCE(${schema.users.isBanned}, false)`, false)
        )
      )
      .limit(1);

    if (!recipient) {
      // Remove the key so a corrected retry can succeed
      if (idempKey) await redis.del(idempKey).catch(() => {});
      throw notFound("Recipient user not found");
    }

    // Block relationship check
    const [blockRow] = await orm
      .select({ id: schema.userBlocks.id })
      .from(schema.userBlocks)
      .where(
        or(
          and(eq(schema.userBlocks.blockerId, senderId), eq(schema.userBlocks.blockedId, body.recipientId)),
          and(eq(schema.userBlocks.blockerId, body.recipientId), eq(schema.userBlocks.blockedId, senderId))
        )
      )
      .limit(1);
    if (blockRow) {
      throw forbidden("Cannot transfer coins to this user", "USER_BLOCKED");
    }

    // Perform the atomic transfer with 5% platform fee.
    // Pass the idempKey as the stable idempotency ref so retried calls with the
    // same key generate the same coin_ledger reference_id (prevents double-debit).
    const transferResult = await transferCoins(
      senderId,
      body.recipientId,
      body.amount,
      idempKey!, // always a string by this point: set at line 154 before redis guard
      5,         // 5% platform fee
      undefined, // no external txClient — transferCoins creates its own transaction
      "gift_sent",
      "gift_received"
    ).catch(async (err) => {
      // Transfer failed — remove the idempotency key so a legitimate retry can proceed
      if (idempKey) await redis.del(idempKey).catch(() => {});
      throw err;
    });

    const { debit, credit, feeCoins } = transferResult;

    // Transfer succeeded — mark key as done (already set; update value for traceability)
    if (idempKey) {
      await redis.set(idempKey, "done", "EX", 86400).catch(() => {});
    }

    // Award XP — awaited so Vercel serverless doesn't drop it before the fn returns
    await awardTransferXP(senderId, body.recipientId, idempKey!);

    return NextResponse.json({
      success: true,
      transfer: {
        grossAmount: body.amount,
        feeCoins,
        netAmount: body.amount - feeCoins,
        recipient: {
          id: recipient.id,
          username: recipient.username,
        },
      },
      senderBalance: debit.balance_after,
      recipientBalance: credit.balance_after,
    });
  } catch (err) {
    // On unexpected errors (not already handled by the transfer catch), clean up the key
    if (idempKey) await redis.del(idempKey).catch(() => {});
    // Rethrow INSUFFICIENT_BALANCE as a friendly 400
    if ((err as NodeJS.ErrnoException).code === "INSUFFICIENT_BALANCE") {
      return handleApiError(
        badRequest("Insufficient coin balance for this transfer", "INSUFFICIENT_BALANCE")
      );
    }
    return handleApiError(err);
  }
});
