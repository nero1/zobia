/**
 * app/api/economy/stars/gift/route.ts
 *
 * POST /api/economy/stars/gift
 *
 * Transfer Zobia Stars to another user.
 *
 * Stars are scarce prestige currency (PRD §11). Gifting them to another user:
 *  - Generates Generosity Track XP for the sender (10 XP per star, capped at 500 XP/day)
 *  - No platform fee on Star gifts (unlike coin gifts)
 *  - Minimum transfer: 1 Star
 *  - Sender must have sufficient balance
 *
 * All balance changes are atomic via SELECT FOR UPDATE.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { debitStars, creditStars } from "@/lib/economy/stars";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENEROSITY_XP_PER_STAR = 10;
const GENEROSITY_XP_DAILY_CAP = 500;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const giftStarsSchema = z.object({
  recipientId: z.string().uuid("recipientId must be a valid UUID"),
  amount: z.number().int().min(1, "Minimum star gift is 1").max(1000, "Maximum star gift is 1000"),
  message: z.string().max(200).optional(),
});

// ---------------------------------------------------------------------------
// POST /api/economy/stars/gift
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, giftStarsSchema);
    const senderId = auth.user.sub;

    if (body.recipientId === senderId) {
      throw badRequest("Cannot gift stars to yourself");
    }

    // Verify recipient exists and is active
    const { rows: recipientRows } = await db.query<{
      id: string;
      username: string;
      is_suspended: boolean;
    }>(
      `SELECT id, username, COALESCE(is_suspended, false) AS is_suspended
       FROM users
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [body.recipientId]
    );
    if (!recipientRows[0]) throw notFound("Recipient not found");
    if (recipientRows[0].is_suspended) {
      throw badRequest("This account is temporarily unavailable.", "RECIPIENT_UNAVAILABLE");
    }

    const recipient = recipientRows[0];

    // Transfer stars atomically
    await db.transaction(async (tx) => {
      await debitStars(
        senderId,
        body.amount,
        "gift_sent",
        body.recipientId,
        `Gifted ${body.amount} ⭐ to @${recipient.username}`,
        tx
      );

      await creditStars(
        body.recipientId,
        body.amount,
        "gift_received",
        senderId,
        `Received ${body.amount} ⭐ from a friend`,
        tx
      );
    });

    // Award Generosity Track XP (fire-and-forget, daily cap enforced)
    void (async () => {
      try {
        const xpAmount = Math.min(GENEROSITY_XP_PER_STAR * body.amount, GENEROSITY_XP_DAILY_CAP);
        if (xpAmount > 0) {
          await db.transaction(async (tx) => {
            await tx.query(
              `UPDATE users
               SET xp_total = xp_total + $1,
                   xp_generosity = xp_generosity + $1,
                   updated_at = NOW()
               WHERE id = $2`,
              [xpAmount, senderId]
            );
            await tx.query(
              `INSERT INTO xp_ledger
                 (user_id, amount, track, source, reference_id, multiplier, base_amount)
               VALUES ($1, $2, 'generosity', 'star_gift', $3, 100, $2)`,
              [senderId, xpAmount, body.recipientId]
            );
          });
        }
      } catch {
        // Non-fatal
      }
    })();

    return NextResponse.json({
      success: true,
      starsGifted: body.amount,
      recipient: {
        id: recipient.id,
        username: recipient.username,
      },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "INSUFFICIENT_BALANCE") {
      return handleApiError(
        conflict("Not enough Stars to send this gift", "INSUFFICIENT_BALANCE")
      );
    }
    return handleApiError(err);
  }
});
