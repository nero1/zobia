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
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";

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
      const orm = await getDb();

      // Verify set exists and is active
      const [set] = await orm
        .select({ id: schema.reactionSets.id, isActive: schema.reactionSets.isActive })
        .from(schema.reactionSets)
        .where(eq(schema.reactionSets.id, setId))
        .limit(1);
      if (!set) throw notFound("Reaction set not found");
      if (!set.isActive) throw badRequest("This reaction set is no longer active");

      // Verify caller owns the set
      const [ownership] = await orm
        .select({ setId: schema.userReactionSets.setId })
        .from(schema.userReactionSets)
        .where(
          and(
            eq(schema.userReactionSets.userId, userId),
            eq(schema.userReactionSets.setId, setId)
          )
        )
        .limit(1);
      if (!ownership) {
        throw forbidden("You do not own this reaction set");
      }

      // Verify the emoji belongs to this set
      const [emojiRow] = await orm
        .select({ id: schema.reactionSetItems.id })
        .from(schema.reactionSetItems)
        .where(
          and(
            eq(schema.reactionSetItems.setId, setId),
            eq(schema.reactionSetItems.emoji, body.emoji)
          )
        )
        .limit(1);
      if (!emojiRow) {
        throw badRequest("This emoji does not belong to the specified reaction set");
      }

      // Verify the target message exists (either a DM/group message or a room message)
      const [roomMsg] = await orm
        .select({ id: schema.roomMessages.id })
        .from(schema.roomMessages)
        .where(
          and(
            eq(schema.roomMessages.id, body.messageId),
            eq(schema.roomMessages.isDeleted, false)
          )
        )
        .limit(1);
      let messageExists = !!roomMsg;
      if (!messageExists) {
        const [msg] = await orm
          .select({ id: schema.messages.id })
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.id, body.messageId),
              eq(schema.messages.isDeleted, false)
            )
          )
          .limit(1);
        messageExists = !!msg;
      }
      if (!messageExists) throw notFound("Message not found");

      // Check today's custom reaction XP count for this user
      const [xpCountRow] = await orm
        .select({ cnt: sql<string>`COUNT(*)` })
        .from(schema.xpLedger)
        .where(
          and(
            eq(schema.xpLedger.userId, userId),
            eq(schema.xpLedger.source, "custom_reaction"),
            gte(schema.xpLedger.createdAt, sql`CURRENT_DATE`)
          )
        );
      const todayCount = parseInt(xpCountRow?.cnt ?? "0", 10);
      const canAwardXP = todayCount < DAILY_REACTION_XP_CAP;

      // Award XP if within daily cap (atomic insert-then-update, idempotent on messageId)
      if (canAwardXP) {
        await safeAwardXP(userId, CUSTOM_REACTION_XP, "social", "custom_reaction", body.messageId);
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
