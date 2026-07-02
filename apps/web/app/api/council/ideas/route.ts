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
import { db } from "@/lib/db";
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
    const { rows } = await db.query<CouncilIdeaRow>(
      `SELECT pci.id, pci.author_id, u.username AS author_username,
              pci.title, pci.description, pci.votes, pci.status, pci.created_at,
              (pci.metadata->'voter_ids' ? $1) AS has_voted
       FROM platform_council_ideas pci
       JOIN users u ON u.id = pci.author_id
       ORDER BY pci.votes DESC, pci.created_at DESC`,
      [userId]
    );

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
    const { rows: memberRows } = await db.query<{ id: string }>(
      `SELECT id FROM platform_council_members
       WHERE user_id = $1 AND left_at IS NULL LIMIT 1`,
      [userId]
    );
    if (!memberRows[0]) {
      throw forbidden("Only Platform Council members can submit ideas");
    }

    const body = await validateBody(req, submitIdeaSchema);

    const { rows: usernameRows } = await db.query<{ username: string }>(
      `SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

    const { rows } = await db.query<Omit<CouncilIdeaRow, "author_username" | "has_voted">>(
      `INSERT INTO platform_council_ideas
         (author_id, title, description, votes, status, created_at)
       VALUES ($1, $2, $3, 0, 'open', NOW())
       RETURNING id, author_id, title, description, votes, status, created_at`,
      [userId, body.title, body.description]
    );

    const idea: CouncilIdeaRow = {
      ...rows[0],
      author_username: usernameRows[0]?.username ?? "",
      has_voted: false,
    };

    return NextResponse.json(
      { success: true, data: { idea }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
