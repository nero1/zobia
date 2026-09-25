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
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
    const orm = await getDb();
    const [row] = await orm
      .select({
        id: schema.creatorSpotlights.id,
        month_year: schema.creatorSpotlights.monthYear,
        blurb: schema.creatorSpotlights.blurb,
        creator_id: schema.creatorSpotlights.creatorId,
        creator_username: schema.users.username,
        creator_display_name: schema.users.displayName,
        creator_avatar_url: schema.users.avatarUrl,
      })
      .from(schema.creatorSpotlights)
      .innerJoin(schema.users, and(eq(schema.users.id, schema.creatorSpotlights.creatorId), isNull(schema.users.deletedAt)))
      .where(eq(schema.creatorSpotlights.isActive, true))
      .limit(1);

    if (!row) {
      return NextResponse.json({ spotlight: null }, { status: 200 });
    }
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
