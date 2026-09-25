export const dynamic = 'force-dynamic';

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
import { eq, and, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { updateConversationScore } from "@/lib/messaging/conversationScore";
import { recordWarContribution } from "@/lib/guilds/recordWarContribution";
import { logger } from "@/lib/logger";

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
      const orm = await getDb();

      // 1. Verify the conversation exists and user is a participant
      const [conv] = await orm
        .select({ userId1: schema.dmConversations.userId1, userId2: schema.dmConversations.userId2 })
        .from(schema.dmConversations)
        .where(eq(schema.dmConversations.id, conversationId))
        .limit(1);

      if (!conv) throw notFound("Conversation not found");

      const isParticipant =
        conv.userId1 === auth.user.sub || conv.userId2 === auth.user.sub;
      if (!isParticipant) {
        throw forbidden("You are not a participant in this conversation");
      }

      // 2. Verify the message belongs to this conversation
      const [message] = await orm
        .select({
          id: schema.messages.id,
          senderId: schema.messages.senderId,
          conversationId: schema.messages.conversationId,
          recipientId: schema.messages.recipientId,
          isDeleted: schema.messages.isDeleted,
        })
        .from(schema.messages)
        .where(and(eq(schema.messages.id, body.messageId), eq(schema.messages.conversationId, conversationId)))
        .limit(1);

      if (!message) throw notFound("Message not found in this conversation");
      if (message.isDeleted) throw badRequest("Cannot react to a deleted message");

      // 3. Toggle reaction
      const [existing] = await orm
        .select({ id: schema.messageReactions.id })
        .from(schema.messageReactions)
        .where(and(
          eq(schema.messageReactions.messageId, body.messageId),
          eq(schema.messageReactions.userId, auth.user.sub),
          eq(schema.messageReactions.emoji, body.emoji),
        ))
        .limit(1);

      if (existing) {
        // Remove existing reaction
        await orm.delete(schema.messageReactions).where(eq(schema.messageReactions.id, existing.id));

        return NextResponse.json(
          { removed: true, messageId: body.messageId, emoji: body.emoji },
          { status: 200 }
        );
      }

      // 4. Add new reaction
      const [reaction] = await orm
        .insert(schema.messageReactions)
        .values({
          messageId: body.messageId,
          userId: auth.user.sub,
          emoji: body.emoji,
          isCustom: body.isCustom,
        })
        .returning();

      if (!reaction) throw new Error("Reaction creation failed");

      // 5. XP awards (fire-and-forget):
      //    a) Custom-reaction XP: 1 XP to the REACTOR (PRD §5 — custom reaction set usage)
      //    b) Social XP: 1 XP to the message SENDER when someone reacts to their message
      void (async () => {
        try {
          // a) Reactor gets 1 XP for using a custom reaction set emoji
          if (body.isCustom && message.senderId !== auth.user.sub) {
            await orm
              .update(schema.users)
              .set({ xpTotal: sql`${schema.users.xpTotal} + 1`, xpSocial: sql`${schema.users.xpSocial} + 1`, updatedAt: sql`NOW()` })
              .where(eq(schema.users.id, auth.user.sub));
            await orm.insert(schema.xpLedger).values({
              userId: auth.user.sub,
              amount: 1,
              track: "social",
              source: "custom_reaction",
              referenceId: reaction.id,
              baseAmount: 1,
            });
          }

          // b) Message sender gets 1 social XP for receiving any reaction (not self-reaction)
          if (message.senderId !== auth.user.sub) {
            await orm
              .update(schema.users)
              .set({ xpTotal: sql`${schema.users.xpTotal} + 1`, xpSocial: sql`${schema.users.xpSocial} + 1`, updatedAt: sql`NOW()` })
              .where(eq(schema.users.id, message.senderId));
            await orm.insert(schema.xpLedger).values({
              userId: message.senderId,
              amount: 1,
              track: "social",
              source: "reaction_received",
              referenceId: reaction.id,
              baseAmount: 1,
            });

            updateConversationScore(
              auth.user.sub,
              message.senderId,
              "reaction_sent"
            ).catch(() => {});
          }
        } catch (err) {
          logger.error({ err: err }, "[reactions:POST] XP award failed");
        }
      })();

      // Record guild war contribution (fire-and-forget)
      recordWarContribution(
        auth.user.sub,
        'react_to_message',
        orm
      ).catch((err) => {
        logger.error({ err: err }, '[reactions:POST] war contribution failed');
        });

      return NextResponse.json({ reaction }, { status: 201 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
