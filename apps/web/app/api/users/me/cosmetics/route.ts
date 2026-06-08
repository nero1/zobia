export const dynamic = 'force-dynamic';

/**
 * app/api/users/me/cosmetics/route.ts
 *
 * PATCH /api/users/me/cosmetics — Equip or unequip a cosmetic frame (PRD §9/§8).
 *
 * Body: { frameId: string | null }
 *   - frameId must be a badge_key the user owns, or null to unequip.
 *   - The frame is stored in users.active_frame_id.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const patchCosmeticsSchema = z.object({
  frameId: z.string().max(100).nullable(),
});

// Known valid frame IDs (maps to /public/cosmetics/frames/<id>.svg)
const VALID_FRAME_IDS = [
  "prestige_frame_1",
  "prestige_frame_2",
  "prestige_frame_3",
  "prestige_frame_4",
  "prestige_frame_5",
  "phoenix_frame",
];

// ---------------------------------------------------------------------------
// PATCH /api/users/me/cosmetics
// ---------------------------------------------------------------------------

export const PATCH = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { frameId } = await validateBody(req, patchCosmeticsSchema);

    if (frameId !== null) {
      if (!VALID_FRAME_IDS.includes(frameId)) {
        return forbidden("Unknown frame ID");
      }

      // Verify the user owns this frame (it must exist as a badge_key in their user_badges)
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM user_badges
         WHERE user_id = $1 AND badge_key = $2
         LIMIT 1`,
        [auth.user.sub, frameId]
      );

      if (!rows[0]) {
        return forbidden("You do not own this frame. Earn it through Prestige progression.");
      }
    }

    await db.query(
      `UPDATE users SET active_frame_id = $1, updated_at = NOW() WHERE id = $2`,
      [frameId, auth.user.sub]
    );

    return NextResponse.json({
      success: true,
      data: { activeFrameId: frameId },
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/users/me/cosmetics
// ---------------------------------------------------------------------------

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const { rows } = await db.query<{
      active_frame_id: string | null;
      owned_frames: string[];
    }>(
      `SELECT
         u.active_frame_id,
         COALESCE(
           ARRAY_AGG(ub.badge_key) FILTER (WHERE ub.badge_key = ANY($2::text[])),
           '{}'::text[]
         ) AS owned_frames
       FROM users u
       LEFT JOIN user_badges ub ON ub.user_id = u.id
       WHERE u.id = $1
       GROUP BY u.active_frame_id`,
      [auth.user.sub, VALID_FRAME_IDS]
    );

    return NextResponse.json({
      success: true,
      data: {
        activeFrameId: rows[0]?.active_frame_id ?? null,
        ownedFrames: rows[0]?.owned_frames ?? [],
        availableFrames: VALID_FRAME_IDS,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
