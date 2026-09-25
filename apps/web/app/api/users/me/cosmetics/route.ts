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
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

export const PATCH = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { frameId } = await validateBody(req, patchCosmeticsSchema);

    if (frameId !== null) {
      if (!VALID_FRAME_IDS.includes(frameId)) {
        return forbidden("Unknown frame ID");
      }

      // Verify the user owns this frame (it must exist as a badge_key in their user_badges)
      const orm = await getDb();
      const [row] = await orm
        .select({ id: schema.userBadges.id })
        .from(schema.userBadges)
        .where(
          and(
            eq(schema.userBadges.userId, auth.user.sub),
            eq(schema.userBadges.badgeKey, frameId)
          )
        )
        .limit(1);

      if (!row) {
        return forbidden("You do not own this frame. Earn it through Prestige progression.");
      }
    }

    // `users.active_frame_id` has no Drizzle column definition in
    // lib/db/schema.ts, so this stays a `sql` template through the Drizzle
    // instance instead of the query builder.
    const orm = await getDb();
    await orm.execute(
      sql`UPDATE users SET active_frame_id = ${frameId}, updated_at = NOW() WHERE id = ${auth.user.sub}`
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
    const orm = await getDb();
    // `users.active_frame_id` has no Drizzle column definition in
    // lib/db/schema.ts, so this stays a `sql` template through the Drizzle
    // instance instead of the query builder.
    const { rows } = await orm.execute<{
      active_frame_id: string | null;
      owned_frames: string[];
    }>(sql`
      SELECT
         u.active_frame_id,
         COALESCE(
           ARRAY_AGG(ub.badge_key) FILTER (WHERE ub.badge_key = ANY(${VALID_FRAME_IDS}::text[])),
           '{}'::text[]
         ) AS owned_frames
       FROM users u
       LEFT JOIN user_badges ub ON ub.user_id = u.id
       WHERE u.id = ${auth.user.sub}
       GROUP BY u.active_frame_id
    `);

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
