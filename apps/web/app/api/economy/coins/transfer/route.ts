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
import { db } from "@/lib/db";
import { transferCoins } from "@/lib/economy/coins";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { redis } from "@/lib/redis";
import { requirePinVerified } from "@/lib/auth/pinGuard";
import { calculateFinalXP, PLAN_XP_MULTIPLIERS_BP } from "@/lib/xp/engine";
import type { Plan } from "@zobia/types";

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
  recipientId: string
): Promise<void> {
  try {
    // Fetch sender plan for multiplier (BUG-06: apply plan multiplier per PRD §6)
    const { rows: planRows } = await db.query<{ plan: Plan }>(
      `SELECT COALESCE(plan, 'free') AS plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [senderId]
    );
    const senderPlan: Plan = planRows[0]?.plan ?? 'free';

    // Sender: send_gift_message is a messaging action — apply plan multiplier per PRD §6
    const { baseXp: senderBaseXp, finalXp: senderXP } = calculateFinalXP(
      'send_gift_message',
      { plan: senderPlan, isMessagingAction: true }
    );
    const senderMultiplierBP = PLAN_XP_MULTIPLIERS_BP[senderPlan];

    // Recipient: receive_gift_and_react is not a messaging action — no plan multiplier
    const { baseXp: recipBaseXp, finalXp: recipientXP } = calculateFinalXP(
      'receive_gift_and_react',
      { plan: 'free', isMessagingAction: false }
    );

    // Write to xp_ledger (canonical XP history table)
    await Promise.all([
      db.query(
        `INSERT INTO xp_ledger
           (user_id, amount, track, source, multiplier, base_amount)
         VALUES ($1, $2, 'generosity', 'coin_transfer_sent', $3, $4)`,
        [senderId, senderXP, senderMultiplierBP, senderBaseXp]
      ),
      db.query(
        `INSERT INTO xp_ledger
           (user_id, amount, track, source, multiplier, base_amount)
         VALUES ($1, $2, 'social', 'coin_transfer_received', 100, $3)`,
        [recipientId, recipientXP, recipBaseXp]
      ),
    ]);

    // Update XP totals and track columns
    await Promise.all([
      db.query(
        `UPDATE users SET xp_total = xp_total + $2, xp_generosity = xp_generosity + $2, updated_at = NOW() WHERE id = $1`,
        [senderId, senderXP]
      ),
      db.query(
        `UPDATE users SET xp_total = xp_total + $2, xp_social = xp_social + $2, updated_at = NOW() WHERE id = $1`,
        [recipientId, recipientXP]
      ),
    ]);
  } catch (err) {
    // XP is best-effort — don't fail the transfer if XP recording fails
    console.error("[coins/transfer] Failed to award XP:", err);
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
    const { rows: recipientRows } = await db.query<{ id: string; username: string }>(
      `SELECT id, username FROM users
       WHERE id = $1 AND deleted_at IS NULL AND is_banned = FALSE
       LIMIT 1`,
      [body.recipientId]
    );

    if (!recipientRows[0]) {
      // Remove the key so a corrected retry can succeed
      if (idempKey) await redis.del(idempKey).catch(() => {});
      throw notFound("Recipient user not found");
    }

    const recipient = recipientRows[0];

    // Block relationship check
    const { rows: blockRows } = await db.query<{ id: string }>(
      `SELECT id FROM user_blocks
       WHERE (blocker_id = $1 AND blocked_id = $2)
          OR (blocker_id = $2 AND blocked_id = $1)
       LIMIT 1`,
      [senderId, body.recipientId]
    );
    if (blockRows[0]) {
      throw forbidden("Cannot transfer coins to this user", "USER_BLOCKED");
    }

    // Perform the atomic transfer with 5% platform fee.
    // Pass the idempKey as the stable idempotency ref so retried calls with the
    // same key generate the same coin_ledger reference_id (prevents double-debit).
    const transferResult = await transferCoins(
      senderId,
      body.recipientId,
      body.amount,
      5,         // 5% platform fee
      undefined, // no external txClient — transferCoins creates its own transaction
      "gift_sent",
      "gift_received",
      idempKey! // always a string by this point: set at line 154 before redis guard
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

    // Award XP (fire-and-forget)
    void awardTransferXP(senderId, body.recipientId);

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
