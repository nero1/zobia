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
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

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

    // Verify message exists in this room and is not deleted
    const { rows: msgRows } = await db.query<{
      id: string;
      sender_id: string;
      room_id: string;
    }>(
      `SELECT id, sender_id, room_id
       FROM room_messages
       WHERE id = $1 AND room_id = $2 AND is_deleted = FALSE
       LIMIT 1`,
      [messageId, roomId]
    );
    const message = msgRows[0];
    if (!message) throw notFound("Message not found");

    // Verify caller is a room member or creator
    const { rows: roomRows } = await db.query<{ creator_id: string }>(
      `SELECT creator_id FROM rooms WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [roomId]
    );
    if (!roomRows[0]) throw notFound("Room not found");

    const isCreator = roomRows[0].creator_id === userId;
    if (!isCreator) {
      const { rows: memberRows } = await db.query<{ id: string }>(
        `SELECT id FROM room_members WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
        [roomId, userId]
      );
      if (!memberRows[0]) {
        throw forbidden("You must be a room member to react to messages");
      }
    }

    // Toggle the reaction
    const { rows: existingRows } = await db.query<{ id: string }>(
      `SELECT id FROM room_message_reactions
       WHERE message_id = $1 AND user_id = $2 AND emoji = $3
       LIMIT 1`,
      [messageId, userId, body.emoji]
    );

    let added: boolean;

    if (existingRows[0]) {
      // Remove existing reaction
      await db.query(
        `DELETE FROM room_message_reactions WHERE id = $1`,
        [existingRows[0].id]
      );
      added = false;
    } else {
      // Add new reaction
      await db.query(
        `INSERT INTO room_message_reactions (message_id, user_id, room_id, emoji)
         VALUES ($1, $2, $3, $4)`,
        [messageId, userId, roomId, body.emoji]
      );
      added = true;

      // 5-reactor milestone: award 10 XP to message sender (fire-and-forget)
      void (async () => {
        try {
          const { rows: countRows } = await db.query<{ cnt: string }>(
            `SELECT COUNT(DISTINCT user_id)::text AS cnt
             FROM room_message_reactions
             WHERE message_id = $1`,
            [messageId]
          );
          const reactorCount = parseInt(countRows[0]?.cnt ?? "0");

          if (reactorCount === 5 && message.sender_id !== userId) {
            // Check if milestone was already awarded for this message
            const { rows: alreadyRows } = await db.query<{ id: string }>(
              `SELECT id FROM xp_events
               WHERE user_id = $1 AND action = 'message_reaction_milestone'
                 AND metadata->>'messageId' = $2
               LIMIT 1`,
              [message.sender_id, messageId]
            );
            if (!alreadyRows[0]) {
              await db.transaction(async (tx) => {
                await tx.query(
                  `UPDATE users
                   SET xp_total = xp_total + 10,
                       xp_social = xp_social + 10,
                       updated_at = NOW()
                   WHERE id = $1`,
                  [message.sender_id]
                );
                await tx.query(
                  `INSERT INTO xp_events
                     (user_id, action, xp_awarded, track, metadata)
                   VALUES ($1, 'message_reaction_milestone', 10, 'social', $2::jsonb)`,
                  [message.sender_id, JSON.stringify({ messageId, roomId })]
                );
              });
            }
          }

          // Custom reaction XP: 1 XP to reactor
          if (body.isCustomReaction) {
            await db.query(
              `UPDATE users
               SET xp_total = xp_total + 1, xp_social = xp_social + 1, updated_at = NOW()
               WHERE id = $1`,
              [userId]
            );
          }
        } catch {
          // Non-fatal
        }
      })();
    }

    // Return current reaction counts for this message
    const { rows: countsRows } = await db.query<{ emoji: string; count: string }>(
      `SELECT emoji, COUNT(*)::text AS count
       FROM room_message_reactions
       WHERE message_id = $1
       GROUP BY emoji
       ORDER BY count DESC`,
      [messageId]
    );

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
