export const dynamic = 'force-dynamic';

/**
 * app/api/economy/reaction-sets/[setId]/use/route.ts
 *
 * POST /api/economy/reaction-sets/:setId/use
 *
 * Record the use of a custom reaction from a purchased reaction set.
 *
 * Awards 1 XP (Social track) to the sender if they own the set.
 * XP is capped at 100 custom reactions per day to prevent farming.
 *
 * Body:
 *   { messageId: string (UUID), emoji: string }
 *
 * Returns:
 *   { xpAwarded: boolean, xpAmount: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** XP awarded per custom reaction use. */
const CUSTOM_REACTION_XP = 1;

/** Maximum custom-reaction XP awards per user per day. */
const DAILY_REACTION_XP_CAP = 100;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const useReactionSchema = z.object({
  /** UUID of the message being reacted to. */
  messageId: z.string().uuid("messageId must be a valid UUID"),
  /** The emoji string from the reaction set being applied. */
  emoji: z.string().min(1).max(10),
});

// ---------------------------------------------------------------------------
// POST /api/economy/reaction-sets/[setId]/use
// ---------------------------------------------------------------------------

/**
 * Apply a custom reaction from an owned reaction set to a message.
 *
 * Ownership check: caller must have purchased the set.
 * Emoji check: the emoji must belong to the specified set.
 * XP: awards 1 XP (Social track) up to 100 times per day.
 *
 * @returns JSON { xpAwarded, xpAmount }
 */
export const POST = withAuth(
  async (req: NextRequest, { params, auth }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

      const userId = auth.user.sub;
      const { setId } = await params as { setId: string };
      const body = await validateBody(req, useReactionSchema);

      // Verify set exists and is active
      const { rows: setRows } = await db.query<{
        id: string;
        is_active: boolean;
      }>(
        `SELECT id, is_active FROM reaction_sets WHERE id = $1`,
        [setId]
      );
      const set = setRows[0];
      if (!set) throw notFound("Reaction set not found");
      if (!set.is_active) throw badRequest("This reaction set is no longer active");

      // Verify caller owns the set
      const { rows: ownershipRows } = await db.query<{ set_id: string }>(
        `SELECT set_id FROM user_reaction_sets WHERE user_id = $1 AND set_id = $2`,
        [userId, setId]
      );
      if (ownershipRows.length === 0) {
        throw forbidden("You do not own this reaction set");
      }

      // Verify the emoji belongs to this set
      const { rows: emojiRows } = await db.query<{ id: string }>(
        `SELECT id FROM reaction_set_items WHERE set_id = $1 AND emoji = $2`,
        [setId, body.emoji]
      );
      if (emojiRows.length === 0) {
        throw badRequest("This emoji does not belong to the specified reaction set");
      }

      // Verify the target message exists
      const { rows: msgRows } = await db.query<{ id: string }>(
        `SELECT id FROM room_messages WHERE id = $1 AND is_deleted = FALSE
         UNION ALL
         SELECT id FROM messages WHERE id = $1 AND is_deleted = FALSE
         LIMIT 1`,
        [body.messageId]
      );
      if (msgRows.length === 0) throw notFound("Message not found");

      // Check today's custom reaction XP count for this user
      const { rows: xpCountRows } = await db.query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt
         FROM xp_ledger
         WHERE user_id = $1
           AND source = 'custom_reaction'
           AND created_at >= CURRENT_DATE`,
        [userId]
      );
      const todayCount = parseInt(xpCountRows[0]?.cnt ?? "0", 10);
      const canAwardXP = todayCount < DAILY_REACTION_XP_CAP;

      // Award XP if within daily cap
      if (canAwardXP) {
        await db.transaction(async (tx) => {
          const { rows: xpRows } = await tx.query<{ id: string }>(
            `INSERT INTO xp_ledger
               (user_id, amount, track, source, reference_id, multiplier, base_amount)
             VALUES ($1, $2, 'social', 'custom_reaction', $3, 1.0, $2)
             ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
             RETURNING id`,
            [userId, CUSTOM_REACTION_XP, body.messageId]
          );
          if (xpRows[0]) {
            await tx.query(
              `UPDATE users
               SET xp_total  = xp_total  + $1,
                   xp_social = xp_social + $1,
                   updated_at = NOW()
               WHERE id = $2`,
              [CUSTOM_REACTION_XP, userId]
            );
          }
        });
      }

      return NextResponse.json(
        {
          xpAwarded: canAwardXP,
          xpAmount: canAwardXP ? CUSTOM_REACTION_XP : 0,
        },
        { status: 200 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);
