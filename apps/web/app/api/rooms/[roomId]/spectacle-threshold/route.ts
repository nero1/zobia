export const dynamic = 'force-dynamic';

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
import { eq, and, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
      const orm = await getDb();

      // Verify the room exists and the caller is its creator
      const [room] = await orm
        .select({ id: schema.rooms.id, creatorId: schema.rooms.creatorId })
        .from(schema.rooms)
        .where(and(eq(schema.rooms.id, roomId), eq(schema.rooms.isActive, true)))
        .limit(1);

      if (!room) {
        throw notFound("Room not found");
      }

      if (room.creatorId !== userId) {
        throw forbidden("Only the room creator can set the spectacle threshold");
      }

      // Update the threshold (null clears it)
      await orm
        .update(schema.rooms)
        .set({ spectacleThresholdCoins: body.thresholdCoins, updatedAt: sql`NOW()` })
        .where(eq(schema.rooms.id, roomId));

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
