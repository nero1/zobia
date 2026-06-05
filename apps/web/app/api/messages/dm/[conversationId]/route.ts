/**
 * app/api/messages/dm/[conversationId]/route.ts
 *
 * GET /api/messages/dm/[conversationId]
 *
 * Returns messages in a specific DM conversation, paginated via
 * cursor-based pagination (cursor = created_at of oldest message returned).
 *
 * Only participants in the conversation may access it.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError, forbidden, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDMCost } from "@/lib/messaging/coinCost";
import type { Plan } from "@zobia/types";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const querySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 100) : 30)),
  /** Cursor: ISO-8601 timestamp of the oldest message from the previous page. */
  before: z.string().optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface ConversationParticipantRow {
  user_id_1: string;
  user_id_2: string;
}

interface RecipientInfoRow {
  id: string;
  coin_balance: number;
  plan: Plan;
  username: string;
  display_name: string | null;
  avatar_emoji: string | null;
}

interface MessageRow {
  id: string;
  sender_id: string;
  sender_username: string;
  sender_display_name: string;
  sender_avatar_emoji: string;
  recipient_id: string;
  message_type: string;
  content: string | null;
  media_url: string | null;
  coin_cost: number;
  is_deleted: boolean;
  reactions: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

/**
 * Fetch messages in a DM conversation (newest-first, cursor-based).
 *
 * Results are returned in descending order so FlatList (inverted) renders
 * the most recent message at the bottom without reversing the array.
 *
 * @param req  - Incoming Next.js request
 * @param ctx  - Route context with conversationId param and auth
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { conversationId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

      const { conversationId } = params;

      // 1. Verify the conversation exists and the user is a participant
      const { rows: convRows } = await db.query<ConversationParticipantRow>(
        `SELECT user_id_1, user_id_2
         FROM dm_conversations
         WHERE id = $1
         LIMIT 1`,
        [conversationId]
      );

      const conv = convRows[0];
      if (!conv) throw notFound("Conversation not found");

      const isParticipant =
        conv.user_id_1 === auth.user.sub ||
        conv.user_id_2 === auth.user.sub;

      if (!isParticipant) {
        throw forbidden("You are not a participant in this conversation");
      }

      // 2. Parse query params
      const { limit, before } = validateSearchParams(
        req.nextUrl.searchParams,
        querySchema
      );

      // 2a. Determine message history window based on user's plan
      //     free: 90 days, plus: 180 days, pro/max: unlimited
      const { rows: planRows } = await db.query<{ plan: string }>(
        `SELECT COALESCE(plan, 'free') AS plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [auth.user.sub]
      );
      const userPlan = planRows[0]?.plan ?? "free";
      let historyFilter = "";
      if (userPlan === "free") {
        historyFilter = `AND m.created_at > NOW() - INTERVAL '90 days'`;
      } else if (userPlan === "plus") {
        historyFilter = `AND m.created_at > NOW() - INTERVAL '180 days'`;
      }
      // pro and max have no history limit

      const cursorClause = before ? `AND m.created_at < $3` : "";
      const params2: (string | number)[] = [conversationId, limit];
      if (before) params2.push(before);

      // 3. Fetch messages with sender profile and reactions
      const { rows } = await db.query<MessageRow>(
        `SELECT
           m.id,
           m.sender_id,
           u.username AS sender_username,
           u.display_name AS sender_display_name,
           u.avatar_emoji AS sender_avatar_emoji,
           m.recipient_id,
           m.message_type,
           CASE WHEN m.is_deleted THEN NULL ELSE m.content END AS content,
           CASE WHEN m.is_deleted THEN NULL ELSE m.media_url END AS media_url,
           m.coin_cost,
           m.is_deleted,
           (
             SELECT json_agg(json_build_object(
               'id', r.id,
               'userId', r.user_id,
               'emoji', r.emoji,
               'isCustom', r.is_custom,
               'createdAt', r.created_at
             ))
             FROM message_reactions r
             WHERE r.message_id = m.id
           ) AS reactions,
           m.created_at,
           m.updated_at
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.conversation_id = $1
           ${historyFilter}
           ${cursorClause}
           AND (m.message_type != 'moment' OR m.created_at > NOW() - INTERVAL '24 hours')
         ORDER BY m.created_at DESC
         LIMIT $2`,
        params2
      );

      // 4. Mark messages as read (best-effort, async)
      db.query(
        `UPDATE messages
         SET is_read = TRUE, updated_at = NOW()
         WHERE conversation_id = $1
           AND recipient_id = $2
           AND is_read = FALSE
           AND is_deleted = FALSE`,
        [conversationId, auth.user.sub]
      ).catch((err) =>
        console.error("[dm/[conversationId]:GET] Mark read failed", err)
      );

      const nextCursor =
        rows.length === limit
          ? rows[rows.length - 1]?.created_at ?? null
          : null;

      // 5. Check if the OTHER participant can reply (sufficient coins)
      //    and fetch their profile for the conversation metadata object
      const otherId =
        conv.user_id_1 === auth.user.sub ? conv.user_id_2 : conv.user_id_1;

      // PRD §5 — Link previews only render after recipient has replied at least twice.
      // Count messages sent by the OTHER user (the recipient from the current user's POV).
      let recipientReplyCount = 0;
      try {
        const { rows: replyCountRows } = await db.query<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt
           FROM messages
           WHERE conversation_id = $1
             AND sender_id = $2
             AND is_deleted = FALSE`,
          [conversationId, otherId]
        );
        recipientReplyCount = parseInt(replyCountRows[0]?.cnt ?? "0", 10);
      } catch {
        // Non-fatal — default to 0 (link previews disabled)
      }

      let recipientCanReply = true;
      let conversationMeta = null;
      try {
        const { rows: recipientRows } = await db.query<RecipientInfoRow>(
          `SELECT id, coin_balance, plan, username, display_name, avatar_emoji
           FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
          [otherId]
        );
        if (recipientRows[0]) {
          const r = recipientRows[0];
          const replyCost = getDMCost(r.plan as Plan, "reply");
          recipientCanReply = r.coin_balance >= replyCost;

          // Also compute the DM cost for the current user
          const { rows: senderRows } = await db.query<{ plan: Plan }>(
            `SELECT COALESCE(plan, 'free') AS plan FROM users WHERE id = $1 LIMIT 1`,
            [auth.user.sub]
          );
          const senderPlan = senderRows[0]?.plan ?? "free";
          const myDmCost = getDMCost(senderPlan, "reply");

          conversationMeta = {
            conversationId,
            participantUserId: r.id,
            participantUsername: r.username,
            participantDisplayName: r.display_name ?? r.username,
            participantAvatarEmoji: r.avatar_emoji ?? "👤",
            dmCoinCost: myDmCost > 0 ? myDmCost : null,
          };
        }
      } catch {
        // Non-fatal — default to true
      }

      return NextResponse.json(
        {
          items: rows.map((row) => ({
            ...row,
            reactions: row.reactions ? JSON.parse(row.reactions) : [],
          })),
          nextCursor,
          hasMore: nextCursor !== null,
          total: rows.length,
          recipientCanReply,
          otherUserId: otherId,
          // PRD §5: gate link previews until recipient has replied at least twice
          recipientReplyCount,
          linkPreviewsEnabled: recipientReplyCount >= 2,
          // conversation metadata for one-request page load
          conversation: conversationMeta,
        },
        { status: 200 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);
