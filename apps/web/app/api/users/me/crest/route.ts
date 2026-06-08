export const dynamic = 'force-dynamic';

/**
 * app/api/users/me/crest/route.ts
 *
 * PUT /api/users/me/crest
 *
 * Set or update the custom crest for the calling user.
 * Exclusively available to Hall of Fame users (Prestige 10, PRD §9).
 *
 * Body: { crest: string }  — emoji or URL string, max 500 chars, or null to clear.
 *
 * Returns: { customCrest: string | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, forbidden } from "@/lib/api/errors";

const CrestSchema = z.object({
  crest: z.string().max(500).nullable(),
});

export const PUT = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    const body = await validateBody(req, CrestSchema);

    // Only Hall of Fame users (prestige_count >= 10) may set a custom crest
    const { rows } = await db.query<{ prestige_count: number }>(
      `SELECT COALESCE(prestige_count, 0) AS prestige_count
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

    if (!rows[0] || rows[0].prestige_count < 10) {
      throw forbidden("Custom crests are exclusively available to Hall of Fame users (Prestige 10).", "HOF_REQUIRED");
    }

    await db.query(
      `UPDATE users SET custom_crest = $1, updated_at = NOW() WHERE id = $2`,
      [body.crest, userId]
    );

    return NextResponse.json({
      success: true,
      data: { customCrest: body.crest },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const { rows } = await db.query<{ custom_crest: string | null; prestige_count: number }>(
      `SELECT custom_crest, COALESCE(prestige_count, 0) AS prestige_count
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

    return NextResponse.json({
      success: true,
      data: {
        customCrest: rows[0]?.custom_crest ?? null,
        eligible: (rows[0]?.prestige_count ?? 0) >= 10,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
