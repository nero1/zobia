export const dynamic = 'force-dynamic';

/**
 * app/api/community-notes/[noteId]/vote/route.ts
 *
 * POST /api/community-notes/:noteId/vote
 *   Vote on a community note.
 *   Body: { helpful: boolean }
 *   Upserts into community_note_votes.
 *   Updates helpful_votes / unhelpful_votes counts.
 *   Auto-promotes to 'shown' if helpfulVotes > 3.
 *   Auto-hides if unhelpfulVotes > helpfulVotes + 2.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const voteSchema = z.object({
  helpful: z.boolean(),
});

// ---------------------------------------------------------------------------
// POST /api/community-notes/:noteId/vote
// ---------------------------------------------------------------------------

export const POST = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: { params: { noteId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { noteId } = await params;
      const userId = auth.user.sub;
      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

      const { helpful } = await validateBody(req, voteSchema);

      const result = await db.transaction(async (tx) => {
        // Verify note exists
        const { rows: noteRows } = await tx.query<{
          id: string;
          helpful_votes: number;
          unhelpful_votes: number;
          status: string;
        }>(
          `SELECT id, helpful_votes, unhelpful_votes, status
           FROM community_notes
           WHERE id = $1
           FOR UPDATE`,
          [noteId]
        );
        if (!noteRows[0]) throw notFound("Community note not found");
        const note = noteRows[0];

        // Check for existing vote by this user
        const { rows: existingVote } = await tx.query<{
          id: string;
          helpful: boolean;
        }>(
          `SELECT id, helpful FROM community_note_votes
           WHERE note_id = $1 AND user_id = $2 LIMIT 1`,
          [noteId, userId]
        );

        let helpfulDelta = 0;
        let unhelpfulDelta = 0;

        if (existingVote.length > 0) {
          const prev = existingVote[0];
          if (prev.helpful === helpful) {
            // Same vote — no change
            return {
              noteId,
              helpful,
              changed: false,
              helpfulVotes: note.helpful_votes,
              unhelpfulVotes: note.unhelpful_votes,
              status: note.status,
            };
          }

          // Flip the vote
          await tx.query(
            `UPDATE community_note_votes SET helpful = $1, created_at = NOW()
             WHERE note_id = $2 AND user_id = $3`,
            [helpful, noteId, userId]
          );

          // Adjust deltas
          if (helpful) {
            helpfulDelta = +1;
            unhelpfulDelta = -1;
          } else {
            helpfulDelta = -1;
            unhelpfulDelta = +1;
          }
        } else {
          // New vote
          await tx.query(
            `INSERT INTO community_note_votes (note_id, user_id, helpful, created_at)
             VALUES ($1, $2, $3, NOW())`,
            [noteId, userId, helpful]
          );

          if (helpful) helpfulDelta = +1;
          else unhelpfulDelta = +1;
        }

        // Update vote counts
        const newHelpful = note.helpful_votes + helpfulDelta;
        const newUnhelpful = note.unhelpful_votes + unhelpfulDelta;

        // Determine new status
        let newStatus = note.status;
        if (newHelpful > 3) {
          newStatus = "shown";
        } else if (newUnhelpful > newHelpful + 2) {
          newStatus = "hidden";
        }

        await tx.query(
          `UPDATE community_notes
           SET helpful_votes = $1,
               unhelpful_votes = $2,
               status = $3,
               updated_at = NOW()
           WHERE id = $4`,
          [newHelpful, newUnhelpful, newStatus, noteId]
        );

        return {
          noteId,
          helpful,
          changed: true,
          helpfulVotes: newHelpful,
          unhelpfulVotes: newUnhelpful,
          status: newStatus,
        };
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
