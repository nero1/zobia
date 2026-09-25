export const dynamic = 'force-dynamic';

/**
 * app/api/messages/dm/[conversationId]/connection-badge/route.ts
 *
 * GET /api/messages/dm/[conversationId]/connection-badge
 *
 * Returns the Connection Badge status for a DM conversation.
 *
 * A Connection Badge is unlocked when two users maintain a daily conversation
 * streak of 7 or more consecutive days.
 *
 * Response:
 *   {
 *     hasBadge: boolean,        // true when streak >= 7 days
 *     streakDays: number,       // current streak length in days
 *     badgeUnlockedAt: string | null  // ISO timestamp when badge was first unlocked
 *   }
 *
 * The conversationId is the canonical ordered pair key stored in
 * conversation_scores (user_id_1:user_id_2, where user_id_1 < user_id_2).
 * Callers may also pass either participant's UUID — the endpoint resolves
 * the pair via the conversation_scores table.
 *
 * Requires authentication. Only participants of the conversation may query.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, type AuthContext } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { checkConnectionBadgeUnlock } from "@/lib/messaging/conversationScore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RouteParams {
  conversationId: string;
}

// ---------------------------------------------------------------------------
// GET /api/messages/dm/[conversationId]/connection-badge
// ---------------------------------------------------------------------------

export const GET = withAuth<RouteParams>(
  async (_req: NextRequest, { auth, params }: { params: RouteParams; auth: AuthContext }) => {
    try {
      const userId = auth.user.sub;
      const { conversationId } = params;

      // The conversationId is expected to be one of the participant UUIDs.
      // We look up the conversation_scores row where the authenticated user
      // is one of the participants.
      const orm = await getDb();
      const rows = await orm
        .select({
          user_id_1: schema.conversationScores.userId1,
          user_id_2: schema.conversationScores.userId2,
          streak_days: schema.conversationScores.streakDays,
          has_connection_badge: schema.conversationScores.hasConnectionBadge,
          badge_unlocked_at: schema.conversationScores.badgeUnlockedAt,
        })
        .from(schema.conversationScores)
        .where(
          or(
            and(eq(schema.conversationScores.userId1, userId), eq(schema.conversationScores.userId2, conversationId)),
            and(eq(schema.conversationScores.userId1, conversationId), eq(schema.conversationScores.userId2, userId)),
            and(
              or(eq(schema.conversationScores.userId1, userId), eq(schema.conversationScores.userId2, userId)),
              or(eq(schema.conversationScores.userId1, conversationId), eq(schema.conversationScores.userId2, conversationId))
            )
          )
        )
        .limit(1);

      // If no record exists yet, return zero-state
      if (!rows[0]) {
        // Verify conversationId is a valid user UUID that the caller could DM
        const [targetRow] = await orm
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(and(eq(schema.users.id, conversationId), isNull(schema.users.deletedAt)))
          .limit(1);
        if (!targetRow) throw notFound("Conversation not found");

        return NextResponse.json({
          success: true,
          data: {
            hasBadge: false,
            streakDays: 0,
            badgeUnlockedAt: null,
          },
          error: null,
        });
      }

      const row = rows[0];

      // Verify the requesting user is a participant in this conversation
      if (row.user_id_1 !== userId && row.user_id_2 !== userId) {
        throw forbidden("You are not a participant in this conversation");
      }

      // Cross-check with the badge unlock function
      const badgeEarned =
        row.has_connection_badge ||
        checkConnectionBadgeUnlock(conversationId, row.streak_days);

      return NextResponse.json({
        success: true,
        data: {
          hasBadge: badgeEarned,
          streakDays: row.streak_days,
          badgeUnlockedAt: row.badge_unlocked_at ?? null,
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
