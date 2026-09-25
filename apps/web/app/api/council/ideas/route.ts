export const dynamic = 'force-dynamic';

/**
 * app/api/council/ideas/route.ts
 *
 * GET /api/council/ideas
 *   List all ideas sorted by votes, with the caller's own vote state.
 *
 * POST /api/council/ideas
 *   Submit a new idea. Council members only.
 *   Body: { title, description }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const submitIdeaSchema = z.object({
  title: z.string().min(5).max(120),
  description: z.string().min(20).max(1000),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CouncilIdeaRow {
  id: string;
  author_id: string;
  author_username: string;
  title: string;
  description: string;
  votes: number;
  status: string;
  created_at: string;
  has_voted: boolean;
}

// ---------------------------------------------------------------------------
// GET /api/council/ideas
// ---------------------------------------------------------------------------

/**
 * FIX: previously omitted the author's username (web/Android both render
 * "@authorUsername") and whether the caller already voted (both clients
 * disable the vote button using this — every idea rendered as un-voted,
 * so a user could re-attempt a vote and get a confusing 409).
 */
export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    const orm = await getDb();
    const { rows } = await orm.execute<CouncilIdeaRow & Record<string, unknown>>(sql`
       SELECT pci.id, pci.author_id, u.username AS author_username,
              pci.title, pci.description, pci.votes, pci.status, pci.created_at,
              (pci.metadata->'voter_ids' ? ${userId}) AS has_voted
       FROM platform_council_ideas pci
       JOIN users u ON u.id = pci.author_id
       ORDER BY pci.votes DESC, pci.created_at DESC
    `);

    return NextResponse.json({
      success: true,
      data: { ideas: rows },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/council/ideas
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    // Verify caller is a council member
    const orm = await getDb();
    const [memberRow] = await orm
      .select({ id: schema.platformCouncilMembers.id })
      .from(schema.platformCouncilMembers)
      .where(and(eq(schema.platformCouncilMembers.userId, userId), isNull(schema.platformCouncilMembers.leftAt)))
      .limit(1);
    if (!memberRow) {
      throw forbidden("Only Platform Council members can submit ideas");
    }

    const body = await validateBody(req, submitIdeaSchema);

    const [usernameRow] = await orm
      .select({ username: schema.users.username })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);

    const [inserted] = await orm
      .insert(schema.platformCouncilIdeas)
      .values({
        authorId: userId,
        title: body.title,
        description: body.description,
        votes: 0,
        status: "open",
      })
      .returning({
        id: schema.platformCouncilIdeas.id,
        author_id: schema.platformCouncilIdeas.authorId,
        title: schema.platformCouncilIdeas.title,
        description: schema.platformCouncilIdeas.description,
        votes: schema.platformCouncilIdeas.votes,
        status: schema.platformCouncilIdeas.status,
        created_at: schema.platformCouncilIdeas.createdAt,
      });

    const idea: CouncilIdeaRow = {
      ...inserted,
      author_username: usernameRow?.username ?? "",
      has_voted: false,
    } as unknown as CouncilIdeaRow;

    return NextResponse.json(
      { success: true, data: { idea }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
