/**
 * app/api/council/ideas/[ideaId]/vote/route.ts
 *
 * POST /api/council/ideas/:ideaId/vote
 *   Upvote an idea. Increments `votes`. Council members only.
 *   One vote per user — checked via a metadata lookup on the idea or
 *   by tracking in a simple JSON column.
 *
 *   Implementation: uses a separate vote-tracking check by querying
 *   if the user already voted (via a dedicated check on the idea metadata).
 *   Since there's no dedicated vote table for council ideas, we track via
 *   a guard using platform_council_ideas metadata JSONB column or a
 *   simple in-row voters array.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// POST /api/council/ideas/:ideaId/vote
// ---------------------------------------------------------------------------

export const POST = withAuth(
  async (
    _req: NextRequest,
    {
      params,
      auth,
    }: { params: { ideaId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { ideaId } = await params;
      const userId = auth.user.sub;
      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

      // Verify caller is a council member
      const { rows: memberRows } = await db.query<{ id: string }>(
        `SELECT id FROM platform_council_members
         WHERE user_id = $1 AND left_at IS NULL LIMIT 1`,
        [userId]
      );
      if (!memberRows[0]) {
        throw forbidden("Only Platform Council members can vote on ideas");
      }

      const result = await db.transaction(async (tx) => {
        // Fetch idea with lock
        const { rows: ideaRows } = await tx.query<{
          id: string;
          votes: number;
          status: string;
          voter_ids: string[] | null;
        }>(
          `SELECT
             id,
             votes,
             status,
             COALESCE(
               (SELECT array_agg(voter_id)
                FROM jsonb_array_elements_text(
                  COALESCE((SELECT metadata->'voter_ids' FROM platform_council_ideas WHERE id = $1), '[]'::jsonb)
                ) AS voter_id),
               ARRAY[]::TEXT[]
             ) AS voter_ids
           FROM platform_council_ideas
           WHERE id = $1
           FOR UPDATE`,
          [ideaId]
        );

        if (!ideaRows[0]) throw notFound("Council idea not found");
        const idea = ideaRows[0];

        if (idea.status === "rejected") {
          throw forbidden("Cannot vote on a rejected idea");
        }

        // Check if user already voted using a simple metadata-based approach
        // We store voter IDs in a JSONB metadata column (voter_ids array)
        const { rows: checkRows } = await tx.query<{ has_voted: boolean }>(
          `SELECT EXISTS(
             SELECT 1 FROM platform_council_ideas
             WHERE id = $1
               AND metadata->'voter_ids' ? $2
           ) AS has_voted`,
          [ideaId, userId]
        );

        if (checkRows[0]?.has_voted) {
          throw conflict("You have already voted on this idea");
        }

        // Increment votes and record voter
        const { rows: updatedRows } = await tx.query<{ votes: number }>(
          `UPDATE platform_council_ideas
           SET votes = votes + 1,
               metadata = jsonb_set(
                 COALESCE(metadata, '{}'::jsonb),
                 '{voter_ids}',
                 COALESCE(metadata->'voter_ids', '[]'::jsonb) || to_jsonb($2::text)
               )
           WHERE id = $1
           RETURNING votes`,
          [ideaId, userId]
        );

        return { ideaId, votes: updatedRows[0].votes };
      });

      return NextResponse.json({
        success: true,
        data: result,
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
