/**
 * app/api/rooms/[roomId]/spectacle-threshold/route.ts
 *
 * PUT /api/rooms/:roomId/spectacle-threshold
 *
 * Allows a room creator to set (or clear) the minimum gift coin value required
 * to trigger the room-wide spectacle animation (PRD §12).
 *
 * Body: { thresholdCoins: number | null }
 *   - null  → disable the creator-level threshold (falls back to gift-item default)
 *   - int >= 1 → set a custom threshold for this room
 *
 * Only the room's creator may call this endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, forbidden, notFound } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SpectacleThresholdSchema = z.object({
  /**
   * Minimum coin cost of a gift to trigger the spectacle animation in this room.
   * Pass null to clear the creator-level override and fall back to the gift-item default.
   */
  thresholdCoins: z
    .union([
      z.number().int().min(1, "thresholdCoins must be a positive integer when set"),
      z.null(),
    ]),
});

// ---------------------------------------------------------------------------
// PUT /api/rooms/:roomId/spectacle-threshold
// ---------------------------------------------------------------------------

export const PUT = withAuth(
  async (
    req: NextRequest,
    { auth, params }: { auth: { user: { sub: string } }; params: { roomId: string } }
  ) => {
    try {
      const userId = auth.user.sub;
      const { roomId } = params;

      const body = await validateBody(req, SpectacleThresholdSchema);

      // Verify the room exists and the caller is its creator
      const { rows: roomRows } = await db.query<{ id: string; creator_id: string }>(
        `SELECT id, creator_id FROM rooms WHERE id = $1 AND is_active = TRUE LIMIT 1`,
        [roomId]
      );

      if (!roomRows[0]) {
        throw notFound("Room not found");
      }

      if (roomRows[0].creator_id !== userId) {
        throw forbidden("Only the room creator can set the spectacle threshold");
      }

      // Update the threshold (null clears it)
      await db.query(
        `UPDATE rooms
         SET spectacle_threshold_coins = $1, updated_at = NOW()
         WHERE id = $2`,
        [body.thresholdCoins, roomId]
      );

      return NextResponse.json(
        {
          success: true,
          data: {
            roomId,
            spectacleThresholdCoins: body.thresholdCoins,
          },
          error: null,
        },
        { status: 200 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);
