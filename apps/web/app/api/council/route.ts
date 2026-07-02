export const dynamic = 'force-dynamic';

/**
 * app/api/council/route.ts
 *
 * GET /api/council
 *   List current Platform Council members (join platform_council_members → users).
 *   Also returns the top 10 ideas sorted by votes.
 *   No auth required.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api/errors";
import { requireFeatureEnabled } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CouncilMemberRow {
  membership_id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string;
  cycle_month: string;
  legacy_score: number;
  joined_at: string;
  rank: number;
}

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
// GET /api/council
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    await requireFeatureEnabled("platformCouncil");
    const [membersResult, ideasResult] = await Promise.all([
      db.query<CouncilMemberRow>(
        `SELECT
           pcm.id AS membership_id,
           pcm.user_id,
           u.username,
           u.display_name,
           u.avatar_emoji,
           pcm.cycle_month,
           pcm.legacy_score,
           pcm.joined_at,
           ROW_NUMBER() OVER (ORDER BY pcm.legacy_score DESC)::int AS rank
         FROM platform_council_members pcm
         JOIN users u ON u.id = pcm.user_id
         WHERE pcm.left_at IS NULL
           AND u.deleted_at IS NULL
         ORDER BY pcm.legacy_score DESC
         LIMIT 50`
      ),
      db.query<CouncilIdeaRow>(
        `SELECT id, author_id, title, description, votes, status, created_at
         FROM platform_council_ideas
         WHERE status != 'rejected'
         ORDER BY votes DESC, created_at DESC
         LIMIT 10`
      ),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        members: membersResult.rows,
        topIdeas: ideasResult.rows,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
