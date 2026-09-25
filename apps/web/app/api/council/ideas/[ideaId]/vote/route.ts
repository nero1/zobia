export const dynamic = 'force-dynamic';

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
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
      const orm = await getDb();
      const [member] = await orm
        .select({ id: schema.platformCouncilMembers.id })
        .from(schema.platformCouncilMembers)
        .where(and(eq(schema.platformCouncilMembers.userId, userId), isNull(schema.platformCouncilMembers.leftAt)))
        .limit(1);
      if (!member) {
        throw forbidden("Only Platform Council members can vote on ideas");
      }

      const result = await orm.transaction(async (tx) => {
        // Fetch idea with lock
        const [idea] = await tx
          .select({
            id: schema.platformCouncilIdeas.id,
            votes: schema.platformCouncilIdeas.votes,
            status: schema.platformCouncilIdeas.status,
          })
          .from(schema.platformCouncilIdeas)
          .where(eq(schema.platformCouncilIdeas.id, ideaId))
          .for("update");

        if (!idea) throw notFound("Council idea not found");

        if (idea.status === "rejected") {
          throw forbidden("Cannot vote on a rejected idea");
        }

        // Check if user already voted using a simple metadata-based approach
        // We store voter IDs in a JSONB metadata column (voter_ids array)
        const [check] = await tx
          .select({
            has_voted: sql<boolean>`EXISTS(
             SELECT 1 FROM platform_council_ideas
             WHERE id = ${ideaId}
               AND metadata->'voter_ids' ? ${userId}
           )`,
          })
          .from(schema.platformCouncilIdeas)
          .where(eq(schema.platformCouncilIdeas.id, ideaId))
          .limit(1);

        if (check?.has_voted) {
          throw conflict("You have already voted on this idea");
        }

        // Increment votes and record voter
        const [updated] = await tx
          .update(schema.platformCouncilIdeas)
          .set({
            votes: sql`${schema.platformCouncilIdeas.votes} + 1`,
            metadata: sql`jsonb_set(
                 COALESCE(${schema.platformCouncilIdeas.metadata}, '{}'::jsonb),
                 '{voter_ids}',
                 COALESCE(${schema.platformCouncilIdeas.metadata}->'voter_ids', '[]'::jsonb) || to_jsonb(${userId}::text)
               )`,
          })
          .where(eq(schema.platformCouncilIdeas.id, ideaId))
          .returning({ votes: schema.platformCouncilIdeas.votes });

        return { ideaId, votes: updated.votes };
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
