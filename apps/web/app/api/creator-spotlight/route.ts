export const dynamic = 'force-dynamic';

/**
 * app/api/creator-spotlight/route.ts
 *
 * Public endpoint for the Creator of the Month Spotlight (PRD §25).
 *
 * GET /api/creator-spotlight
 *   Returns the currently active spotlight with creator profile info.
 *   No authentication required — used by the Discover feed widget.
 *
 *   Response:
 *     200  { spotlight: SpotlightPublic }   when an active spotlight exists
 *     200  { spotlight: null }              when no active spotlight is set
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpotlightPublic {
  id: string;
  month_year: string;
  blurb: string | null;
  creator: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  };
}

interface SpotlightRow {
  id: string;
  month_year: string;
  blurb: string | null;
  creator_id: string;
  creator_username: string;
  creator_display_name: string | null;
  creator_avatar_url: string | null;
}

// ---------------------------------------------------------------------------
// GET /api/creator-spotlight
// ---------------------------------------------------------------------------

/**
 * Returns the active Creator of the Month spotlight.
 *
 * @returns JSON { spotlight: SpotlightPublic | null }
 */
export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const { rows } = await db.query<SpotlightRow>(
      `SELECT
         cs.id,
         cs.month_year,
         cs.blurb,
         cs.creator_id,
         u.username        AS creator_username,
         u.display_name    AS creator_display_name,
         u.avatar_url      AS creator_avatar_url
       FROM creator_spotlights cs
       JOIN users u ON u.id = cs.creator_id AND u.deleted_at IS NULL
       WHERE cs.is_active = TRUE
       LIMIT 1`
    );

    if (!rows[0]) {
      return NextResponse.json({ spotlight: null }, { status: 200 });
    }

    const row = rows[0];
    const spotlight: SpotlightPublic = {
      id: row.id,
      month_year: row.month_year,
      blurb: row.blurb,
      creator: {
        id: row.creator_id,
        username: row.creator_username,
        display_name: row.creator_display_name,
        avatar_url: row.creator_avatar_url,
      },
    };

    return NextResponse.json({ spotlight }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
}
