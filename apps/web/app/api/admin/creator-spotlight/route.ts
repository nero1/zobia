export const dynamic = 'force-dynamic';

/**
 * app/api/admin/creator-spotlight/route.ts
 *
 * Admin endpoints for the Creator of the Month Spotlight (PRD §25).
 *
 * GET  /api/admin/creator-spotlight
 *   Return all spotlights (current + past) joined with creator user info,
 *   ordered by month_year descending.
 *
 * POST /api/admin/creator-spotlight
 *   Create a new monthly spotlight.
 *   Body: { creatorId: string, monthYear: string (YYYY-MM), blurb?: string }
 *   - Admin only.
 *   - Validates that the creator user exists.
 *   - Validates monthYear format.
 *   - Enforces one spotlight per calendar month (UNIQUE constraint + pre-check).
 *   - Marks the new spotlight as is_active = true when it is the current month,
 *     and deactivates any previously active spotlight first.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createSpotlightSchema = z.object({
  creatorId: z.string().uuid("creatorId must be a valid UUID"),
  monthYear: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "monthYear must be in YYYY-MM format"),
  blurb: z.string().max(500, "blurb must be 500 characters or fewer").optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface SpotlightRow {
  id: string;
  creator_id: string;
  month_year: string;
  blurb: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  // joined from users (creator)
  creator_username: string | null;
  creator_display_name: string | null;
  creator_avatar_url: string | null;
  // joined from users (admin who created)
  admin_username: string | null;
}

// ---------------------------------------------------------------------------
// GET /api/admin/creator-spotlight
// ---------------------------------------------------------------------------

/**
 * List all creator spotlights with creator and admin info.
 *
 * @returns JSON { spotlights: SpotlightRow[] }
 */
export const GET = withAdminAuth(async (_req: NextRequest) => {
  try {
    const { rows } = await db.query<SpotlightRow>(
      `SELECT
         cs.id,
         cs.creator_id,
         cs.month_year,
         cs.blurb,
         cs.is_active,
         cs.created_at,
         cs.created_by,
         u.username        AS creator_username,
         u.display_name    AS creator_display_name,
         u.avatar_url      AS creator_avatar_url,
         a.username        AS admin_username
       FROM creator_spotlights cs
       LEFT JOIN users u ON u.id = cs.creator_id
       LEFT JOIN users a ON a.id = cs.created_by
       ORDER BY cs.month_year DESC`
    );

    return NextResponse.json({ spotlights: rows }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/creator-spotlight
// ---------------------------------------------------------------------------

/**
 * Create a new monthly creator spotlight.
 *
 * Validates:
 *  - creatorId points to an existing, non-deleted user.
 *  - monthYear is unique (one spotlight per month).
 *
 * When the new spotlight is for the current calendar month it is immediately
 * set as active and any existing active spotlight is deactivated.
 *
 * @returns JSON { spotlight: SpotlightRow }
 */
export const POST = withAdminAuth(async (req: NextRequest, ctx) => {
  try {
    const body = await validateBody(req, createSpotlightSchema);

    // Validate creator user exists
    const { rows: userRows } = await db.query<{
      id: string;
      username: string;
      display_name: string | null;
      avatar_url: string | null;
    }>(
      `SELECT id, username, display_name, avatar_url
       FROM users
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [body.creatorId]
    );

    if (!userRows[0]) {
      throw notFound(`User ${body.creatorId} does not exist`);
    }

    // Check for existing spotlight for this month
    const { rows: existing } = await db.query<{ id: string }>(
      `SELECT id FROM creator_spotlights WHERE month_year = $1 LIMIT 1`,
      [body.monthYear]
    );

    if (existing[0]) {
      throw badRequest(
        `A spotlight already exists for ${body.monthYear}. Only one spotlight is allowed per month.`,
        "MONTH_ALREADY_SPOTLIGHTED"
      );
    }

    // Determine whether this spotlight should be immediately active.
    // Active = the monthYear matches the current calendar month.
    const now = new Date();
    const currentMonthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const isActive = body.monthYear === currentMonthYear;

    // Run deactivation + insert in a transaction
    const { rows: inserted } = await db.query<{ id: string }>(
      `
      WITH deactivate AS (
        UPDATE creator_spotlights
        SET    is_active = FALSE
        WHERE  is_active = TRUE
          AND  $1 = TRUE
      )
      INSERT INTO creator_spotlights
        (creator_id, month_year, blurb, is_active, created_by)
      VALUES
        ($2, $3, $4, $1, $5)
      RETURNING id
      `,
      [
        isActive,
        body.creatorId,
        body.monthYear,
        body.blurb ?? null,
        ctx.auth.user.sub,
      ]
    );

    const newId = inserted[0]?.id;
    if (!newId) throw new Error("Insert did not return an id");

    // Fetch the full row with joins
    const { rows: fullRows } = await db.query<SpotlightRow>(
      `SELECT
         cs.id,
         cs.creator_id,
         cs.month_year,
         cs.blurb,
         cs.is_active,
         cs.created_at,
         cs.created_by,
         u.username        AS creator_username,
         u.display_name    AS creator_display_name,
         u.avatar_url      AS creator_avatar_url,
         a.username        AS admin_username
       FROM creator_spotlights cs
       LEFT JOIN users u ON u.id = cs.creator_id
       LEFT JOIN users a ON a.id = cs.created_by
       WHERE cs.id = $1`,
      [newId]
    );

    return NextResponse.json({ spotlight: fullRows[0] }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
