/**
 * app/api/council/ideas/route.ts
 *
 * GET /api/council/ideas
 *   List all ideas sorted by votes. No auth required.
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
  title: string;
  description: string;
  votes: number;
  status: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/council/ideas
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const { rows } = await db.query<CouncilIdeaRow>(
      `SELECT id, author_id, title, description, votes, status, created_at
       FROM platform_council_ideas
       ORDER BY votes DESC, created_at DESC`
    );

    return NextResponse.json({
      success: true,
      data: { ideas: rows },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/council/ideas
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { auth }) => {
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

    const { rows } = await db.query<CouncilIdeaRow>(
      `INSERT INTO platform_council_ideas
         (author_id, title, description, votes, status, created_at)
       VALUES ($1, $2, $3, 0, 'open', NOW())
       RETURNING id, author_id, title, description, votes, status, created_at`,
      [userId, body.title, body.description]
    );

    return NextResponse.json(
      { success: true, data: { idea: rows[0] }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
