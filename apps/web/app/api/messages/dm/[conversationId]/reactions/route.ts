/**
 * app/api/messages/dm/[conversationId]/reactions/route.ts
 *
 * POST /api/messages/dm/[conversationId]/reactions
 *
 * Add or toggle a reaction on a message within a DM conversation.
 * - If the same user+emoji combo exists, the reaction is removed (toggle).
 * - If it doesn't exist, it is added.
 * - Awards 1 XP (Social track) to the message sender for receiving a reaction.
 *
 * Only conversation participants may react.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { updateConversationScore } from "@/lib/messaging/conversationScore";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const addReactionSchema = z.object({
  messageId: z.string().uuid("messageId must be a valid UUID"),
  emoji: z
    .string()
    .min(1, "emoji is required")
    .max(10, "emoji must be at most 10 characters"),
  isCustom: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface MessageOwnerRow {
  id: string;
  sender_id: string;
  conversation_id: string;
  recipient_id: string;
  is_deleted: boolean;
}

interface ConversationParticipantRow {
  user_id_1: string;
  user_id_2: string;
}

interface ExistingReactionRow {
  id: string;
}

interface ReactionRow {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  is_custom: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

/**
 * Toggle a reaction on a message.
 *
 * Returns:
 *  - 201 with the created reaction if it was added
 *  - 200 with `{ removed: true, messageId, emoji }` if it was removed
 */
export const POST = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: {
      params: { conversationId: string };
      auth: { user: { sub: string; is_admin?: boolean } };
    }
  ) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

      const { conversationId } = params;
      const body = await validateBody(req, addReactionSchema);

      // 1. Verify the conversation exists and user is a participant
      const { rows: convRows } = await db.query<ConversationParticipantRow>(
        `SELECT user_id_1, user_id_2
         FROM dm_conversations
         WHERE id = $1 LIMIT 1`,
        [conversationId]
      );

      const conv = convRows[0];
      if (!conv) throw notFound("Conversation not found");

      const isParticipant =
        conv.user_id_1 === auth.user.sub || conv.user_id_2 === auth.user.sub;
      if (!isParticipant) {
        throw forbidden("You are not a participant in this conversation");
      }

      // 2. Verify the message belongs to this conversation
      const { rows: msgRows } = await db.query<MessageOwnerRow>(
        `SELECT id, sender_id, conversation_id, recipient_id, is_deleted
         FROM messages
         WHERE id = $1 AND conversation_id = $2 LIMIT 1`,
        [body.messageId, conversationId]
      );

      const message = msgRows[0];
      if (!message) throw notFound("Message not found in this conversation");
      if (message.is_deleted) throw badRequest("Cannot react to a deleted message");

      // 3. Toggle reaction
      const { rows: existingRows } = await db.query<ExistingReactionRow>(
        `SELECT id FROM message_reactions
         WHERE message_id = $1 AND user_id = $2 AND emoji = $3 LIMIT 1`,
        [body.messageId, auth.user.sub, body.emoji]
      );

      if (existingRows[0]) {
        // Remove existing reaction
        await db.query(
          `DELETE FROM message_reactions WHERE id = $1`,
          [existingRows[0].id]
        );

        return NextResponse.json(
          { removed: true, messageId: body.messageId, emoji: body.emoji },
          { status: 200 }
        );
      }

      // 4. Add new reaction
      const { rows: reactionRows } = await db.query<ReactionRow>(
        `INSERT INTO message_reactions (message_id, user_id, emoji, is_custom)
         VALUES ($1, $2, $3, $4)
         RETURNING id, message_id, user_id, emoji, is_custom, created_at`,
        [body.messageId, auth.user.sub, body.emoji, body.isCustom]
      );

      const reaction = reactionRows[0];
      if (!reaction) throw new Error("Reaction creation failed");

      // 5. XP awards (fire-and-forget):
      //    a) Custom-reaction XP: 1 XP to the REACTOR (PRD §5 — custom reaction set usage)
      //    b) Social XP: 1 XP to the message SENDER when someone reacts to their message
      void (async () => {
        try {
          // a) Reactor gets 1 XP for using a custom reaction set emoji
          if (body.isCustom && message.sender_id !== auth.user.sub) {
            await db.query(
              `UPDATE users SET xp_total = xp_total + 1, xp_social = xp_social + 1, updated_at = NOW()
               WHERE id = $1`,
              [auth.user.sub]
            );
            await db.query(
              `INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, multiplier, base_amount)
               VALUES ($1, 1, 'social', 'custom_reaction', $2, 1, 1)`,
              [auth.user.sub, reaction.id]
            );
          }

          // b) Message sender gets 1 social XP for receiving any reaction (not self-reaction)
          if (message.sender_id !== auth.user.sub) {
            await db.query(
              `UPDATE users SET xp_total = xp_total + 1, xp_social = xp_social + 1, updated_at = NOW()
               WHERE id = $1`,
              [message.sender_id]
            );
            await db.query(
              `INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, multiplier, base_amount)
               VALUES ($1, 1, 'social', 'reaction_received', $2, 1, 1)`,
              [message.sender_id, reaction.id]
            );

            updateConversationScore(
              auth.user.sub,
              message.sender_id,
              "reaction_sent"
            ).catch(() => {});
          }
        } catch (err) {
          console.error("[reactions:POST] XP award failed", err);
        }
      })();

      return NextResponse.json({ reaction }, { status: 201 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
