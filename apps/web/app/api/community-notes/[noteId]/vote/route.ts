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
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

      const orm = await getDb();
      const result = await orm.transaction(async (tx) => {
        // Verify note exists
        const [note] = await tx
          .select({
            id: schema.communityNotes.id,
            helpful_votes: schema.communityNotes.helpfulVotes,
            unhelpful_votes: schema.communityNotes.unhelpfulVotes,
            status: schema.communityNotes.status,
          })
          .from(schema.communityNotes)
          .where(eq(schema.communityNotes.id, noteId))
          .for("update");
        if (!note) throw notFound("Community note not found");

        // Check for existing vote by this user
        const [prev] = await tx
          .select({ id: schema.communityNoteVotes.id, helpful: schema.communityNoteVotes.helpful })
          .from(schema.communityNoteVotes)
          .where(and(eq(schema.communityNoteVotes.noteId, noteId), eq(schema.communityNoteVotes.userId, userId)))
          .limit(1);

        let helpfulDelta = 0;
        let unhelpfulDelta = 0;

        if (prev) {
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
          await tx
            .update(schema.communityNoteVotes)
            .set({ helpful, createdAt: new Date() })
            .where(and(eq(schema.communityNoteVotes.noteId, noteId), eq(schema.communityNoteVotes.userId, userId)));

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
          await tx.insert(schema.communityNoteVotes).values({ noteId, userId, helpful });

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

        await tx
          .update(schema.communityNotes)
          .set({ helpfulVotes: newHelpful, unhelpfulVotes: newUnhelpful, status: newStatus, updatedAt: new Date() })
          .where(eq(schema.communityNotes.id, noteId));

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
