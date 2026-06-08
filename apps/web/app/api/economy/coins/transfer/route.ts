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
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { transferCoins } from "@/lib/economy/coins";

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
});

// ---------------------------------------------------------------------------
// XP helpers (fire-and-forget after atomic coin transfer)
// ---------------------------------------------------------------------------

async function awardTransferXP(
  senderId: string,
  recipientId: string
): Promise<void> {
  try {
    // Award XP to sender (Generosity) and recipient (Social)
    await Promise.all([
      db.query(
        `INSERT INTO xp_events
           (user_id, action, xp_awarded, track, metadata)
         VALUES ($1, 'coin_transfer_sent', 10, 'generosity', $2::jsonb)`,
        [senderId, JSON.stringify({ recipientId })]
      ),
      db.query(
        `INSERT INTO xp_events
           (user_id, action, xp_awarded, track, metadata)
         VALUES ($1, 'coin_transfer_received', 5, 'social', $2::jsonb)`,
        [recipientId, JSON.stringify({ senderId })]
      ),
    ]);

    // Update XP totals and track columns
    await Promise.all([
      db.query(
        `UPDATE users SET xp_total = xp_total + 10, xp_generosity = xp_generosity + 10, updated_at = NOW() WHERE id = $1`,
        [senderId]
      ),
      db.query(
        `UPDATE users SET xp_total = xp_total + 5, xp_social = xp_social + 5, updated_at = NOW() WHERE id = $1`,
        [recipientId]
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
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const body = await validateBody(req, TransferSchema);
    const senderId = auth.user.sub;

    // Prevent self-transfers
    if (body.recipientId === senderId) {
      throw badRequest("Cannot transfer coins to yourself");
    }

    // Verify the recipient exists
    const { rows: recipientRows } = await db.query<{ id: string; username: string }>(
      `SELECT id, username FROM users
       WHERE id = $1 AND deleted_at IS NULL AND is_banned = FALSE
       LIMIT 1`,
      [body.recipientId]
    );

    if (!recipientRows[0]) {
      throw notFound("Recipient user not found");
    }

    const recipient = recipientRows[0];

    // Perform the atomic transfer with 5% platform fee
    const { debit, credit, feeCoins } = await transferCoins(
      senderId,
      body.recipientId,
      body.amount,
      5 // 5% platform fee
    );

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
    // Rethrow INSUFFICIENT_BALANCE as a friendly 400
    if ((err as NodeJS.ErrnoException).code === "INSUFFICIENT_BALANCE") {
      return handleApiError(
        badRequest("Insufficient coin balance for this transfer", "INSUFFICIENT_BALANCE")
      );
    }
    return handleApiError(err);
  }
});
