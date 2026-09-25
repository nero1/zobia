export const dynamic = 'force-dynamic';

/**
 * app/api/rooms/[roomId]/messages/[messageId]/reactions/route.ts
 *
 * POST /api/rooms/:roomId/messages/:messageId/reactions
 *
 * Toggle an emoji reaction on a room message. Idempotent:
 *  - If the user has not yet reacted with this emoji, the reaction is added.
 *  - If the user has already reacted with this emoji, the reaction is removed.
 *
 * On the 5th unique reactor on a message, awards 10 bonus XP to the message
 * sender (once per message — the milestone fires only once).
 *
 * Reacting with a custom reaction set emoji awards 1 XP to the reactor.
 *
 * @module app/api/rooms/[roomId]/messages/[messageId]/reactions
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const reactSchema = z.object({
  emoji: z
    .string()
    .min(1, "emoji is required")
    .max(8, "emoji too long"),
  /** Set to true when using a purchasable custom reaction set. Awards 1 XP. */
  isCustomReaction: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Route params
// ---------------------------------------------------------------------------

interface ReactParams {
  roomId: string;
  messageId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// POST /api/rooms/[roomId]/messages/[messageId]/reactions
// ---------------------------------------------------------------------------

export const POST = withAuth<ReactParams>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { roomId, messageId } = params;
    if (!UUID_RE.test(roomId)) throw badRequest("roomId must be a valid UUID");
    if (!UUID_RE.test(messageId)) throw badRequest("messageId must be a valid UUID");

    const body = await validateBody(req, reactSchema);
    const userId = auth.user.sub;
    const orm = await getDb();

    // Verify message exists in this room and is not deleted
    const [message] = await orm
      .select({ id: schema.roomMessages.id, senderId: schema.roomMessages.senderId, roomId: schema.roomMessages.roomId })
      .from(schema.roomMessages)
      .where(and(
        eq(schema.roomMessages.id, messageId),
        eq(schema.roomMessages.roomId, roomId),
        eq(schema.roomMessages.isDeleted, false),
      ))
      .limit(1);
    if (!message) throw notFound("Message not found");

    // Verify caller is a room member or creator
    const [room] = await orm
      .select({ creatorId: schema.rooms.creatorId })
      .from(schema.rooms)
      .where(and(eq(schema.rooms.id, roomId), sql`${schema.rooms.deletedAt} IS NULL`))
      .limit(1);
    if (!room) throw notFound("Room not found");

    const isCreator = room.creatorId === userId;
    if (!isCreator) {
      const [member] = await orm
        .select({ id: schema.roomMembers.id })
        .from(schema.roomMembers)
        .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, userId)))
        .limit(1);
      if (!member) {
        throw forbidden("You must be a room member to react to messages");
      }
    }

    // Toggle the reaction
    const [existing] = await orm
      .select({ id: schema.roomMessageReactions.id })
      .from(schema.roomMessageReactions)
      .where(and(
        eq(schema.roomMessageReactions.messageId, messageId),
        eq(schema.roomMessageReactions.userId, userId),
        eq(schema.roomMessageReactions.emoji, body.emoji),
      ))
      .limit(1);

    let added: boolean;

    if (existing) {
      // Remove existing reaction
      await orm.delete(schema.roomMessageReactions).where(eq(schema.roomMessageReactions.id, existing.id));
      added = false;
    } else {
      // Add new reaction
      await orm.insert(schema.roomMessageReactions).values({
        messageId,
        userId,
        roomId,
        emoji: body.emoji,
      });
      added = true;

      // 5-reactor milestone: award 10 XP to message sender (fire-and-forget)
      void (async () => {
        try {
          const [{ count }] = await orm
            .select({ count: sql<string>`COUNT(DISTINCT ${schema.roomMessageReactions.userId})` })
            .from(schema.roomMessageReactions)
            .where(eq(schema.roomMessageReactions.messageId, messageId));
          const reactorCount = parseInt(count ?? "0");

          if (reactorCount === 5 && message.senderId !== userId) {
            // Award 10 XP to message sender on 5th unique reactor milestone.
            // reference_id is per-message so the award fires exactly once.
            await safeAwardXP(
              message.senderId,
              10,
              "social",
              "message_reaction_milestone",
              `milestone:reaction5:${messageId}`
            );
          }

          // Custom reaction XP: 1 XP to reactor via xp_ledger
          if (body.isCustomReaction) {
            await safeAwardXP(
              userId,
              1,
              "social",
              "custom_reaction_room",
              `custom_reaction:${userId}:${messageId}`
            );
          }
        } catch {
          // Non-fatal
        }
      })();
    }

    // Return current reaction counts for this message
    const countsRows = await orm
      .select({ emoji: schema.roomMessageReactions.emoji, count: sql<string>`COUNT(*)` })
      .from(schema.roomMessageReactions)
      .where(eq(schema.roomMessageReactions.messageId, messageId))
      .groupBy(schema.roomMessageReactions.emoji)
      .orderBy(sql`COUNT(*) DESC`);

    return NextResponse.json(
      {
        added,
        emoji: body.emoji,
        reactions: countsRows.map((r) => ({
          emoji: r.emoji,
          count: parseInt(r.count),
        })),
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
