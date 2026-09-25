export const dynamic = 'force-dynamic';

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
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { debitStars, creditStars } from "@/lib/economy/stars";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";

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

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.starGift);

    const body = await validateBody(req, giftStarsSchema);
    const senderId = auth.user.sub;

    if (body.recipientId === senderId) {
      throw badRequest("Cannot gift stars to yourself");
    }

    // Verify recipient exists and is active
    const orm = await getDb();
    const [recipientRow] = await orm
      .select({
        id: schema.users.id,
        username: schema.users.username,
        isSuspended: schema.users.isSuspended,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, body.recipientId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!recipientRow) throw notFound("Recipient not found");
    if (recipientRow.isSuspended) {
      throw badRequest("This account is temporarily unavailable.", "RECIPIENT_UNAVAILABLE");
    }

    const recipient = recipientRow;

    // Transfer stars atomically.
    // STAR-NOIDEM: the reference must be transaction-specific, not the counterparty's
    // user ID — using recipientId/senderId as the reference meant a sender could only
    // ever gift stars to the same recipient once (every subsequent gift would collide
    // on the user_id+transaction_type+reference_id ledger index).
    const transferRef = randomUUID();
    await orm.transaction(async (tx) => {
      await debitStars(
        senderId,
        body.amount,
        "gift_sent",
        transferRef,
        `Gifted ${body.amount} ⭐ to @${recipient.username}`,
        tx
      );

      await creditStars(
        body.recipientId,
        body.amount,
        "gift_received",
        transferRef,
        `Received ${body.amount} ⭐ from a friend`,
        tx
      );
    });

    // Award Generosity Track XP (fire-and-forget, cumulative daily cap enforced)
    void (async () => {
      try {
        // BUG-XP-16: enforce a cumulative daily cap by querying how much XP has
        // already been awarded today for star_gift, then cap the remaining budget.
        const orm = await getDb();
        const [xpRow] = await orm
          .select({ totalXp: sql<string>`COALESCE(SUM(${schema.xpLedger.amount}), 0)::text` })
          .from(schema.xpLedger)
          .where(
            and(
              eq(schema.xpLedger.userId, senderId),
              eq(schema.xpLedger.track, "generosity"),
              eq(schema.xpLedger.source, "star_gift"),
              gte(schema.xpLedger.createdAt, sql`CURRENT_DATE`)
            )
          );
        const todayXp = parseInt(xpRow?.totalXp ?? "0", 10);
        const remaining = Math.max(0, GENEROSITY_XP_DAILY_CAP - todayXp);
        const xpAmount = Math.min(GENEROSITY_XP_PER_STAR * body.amount, remaining);

        if (xpAmount > 0) {
          // BUG-XP-15: use transferRef (not body.recipientId) as reference_id so
          // each gift generates a unique XP ledger entry and is properly idempotent.
          await safeAwardXP(senderId, xpAmount, 'generosity', 'star_gift', `xp_gift:${transferRef}`);
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
