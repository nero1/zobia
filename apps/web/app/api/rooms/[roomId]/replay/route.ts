/**
 * app/api/rooms/[roomId]/replay/route.ts
 *
 * GET /api/rooms/:roomId/replay
 *   Get drop room replay. Check if published. Check if paid (deduct replay fee if set).
 *
 * POST /api/rooms/:roomId/replay
 *   Create/publish replay (room creator only).
 *   Body: { title, highlights, replay_fee_kobo }
 *   Inserts/upserts drop_room_replays.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const highlightSchema = z.object({
  message_id: z.string().uuid().optional(),
  content: z.string(),
  sender: z.string(),
  timestamp: z.string(),
});

const createReplaySchema = z.object({
  title: z.string().min(3).max(150),
  highlights: z.array(highlightSchema).min(1),
  replay_fee_kobo: z.number().int().nonnegative().default(0),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DropRoomReplayRow {
  id: string;
  room_id: string;
  creator_id: string;
  title: string;
  highlights: unknown;
  replay_fee_kobo: string;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/rooms/:roomId/replay
// ---------------------------------------------------------------------------

export const GET = withAuth(
  async (
    _req: NextRequest,
    {
      params,
      auth,
    }: { params: { roomId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { roomId } = await params;
      const userId = auth.user.sub;

      // Fetch replay
      const { rows } = await db.query<DropRoomReplayRow>(
        `SELECT id, room_id, creator_id, title, highlights,
                replay_fee_kobo::TEXT AS replay_fee_kobo,
                is_published, published_at, created_at
         FROM drop_room_replays
         WHERE room_id = $1 LIMIT 1`,
        [roomId]
      );

      if (!rows[0]) throw notFound("Replay not found for this room");
      const replay = rows[0];

      // Check if published (only creator can see unpublished)
      if (!replay.is_published && replay.creator_id !== userId) {
        throw notFound("Replay is not yet published");
      }

      const replayFeeKobo = parseInt(replay.replay_fee_kobo, 10);
      const isFree = replayFeeKobo <= 0;
      const isCreator = replay.creator_id === userId;

      // Check if user has purchased access (purchase is done via POST /replay/purchase)
      let hasPurchased = false;
      if (!isFree && !isCreator) {
        const { rows: accessRows } = await db.query<{ id: string }>(
          `SELECT id FROM coin_ledger
           WHERE user_id = $1
             AND reference_id = $2
             AND transaction_type = 'replay_access'
           LIMIT 1`,
          [userId, replay.id]
        );
        hasPurchased = !!accessRows[0];
      }

      const userHasAccess = isFree || isCreator || hasPurchased;

      return NextResponse.json({
        success: true,
        userHasAccess,
        data: {
          replay: {
            ...replay,
            replayFeeKobo,
            replayFeeCoins: Math.ceil(replayFeeKobo / 100),
            isPublished: replay.is_published,
            highlights: replay.highlights,
          },
        },
        replay: {
          ...replay,
          replayFeeKobo,
          replayFeeCoins: Math.ceil(replayFeeKobo / 100),
          isPublished: replay.is_published,
          highlights: replay.highlights,
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/rooms/:roomId/replay
// ---------------------------------------------------------------------------

export const POST = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: { params: { roomId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { roomId } = await params;
      const userId = auth.user.sub;
      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

      // Verify caller is the room creator
      const { rows: roomRows } = await db.query<{ creator_id: string; room_type: string }>(
        `SELECT creator_id, room_type FROM rooms WHERE id = $1 LIMIT 1`,
        [roomId]
      );
      if (!roomRows[0]) throw notFound("Room not found");
      if (roomRows[0].creator_id !== userId) {
        throw forbidden("Only the room creator can publish a replay");
      }
      if (roomRows[0].room_type !== "drop") {
        throw forbidden("Replays are only available for Drop rooms");
      }

      const body = await validateBody(req, createReplaySchema);

      const { rows } = await db.query<DropRoomReplayRow>(
        `INSERT INTO drop_room_replays
           (room_id, creator_id, title, highlights, replay_fee_kobo, is_published, published_at, created_at)
         VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), NOW())
         ON CONFLICT (room_id) DO UPDATE
           SET title = EXCLUDED.title,
               highlights = EXCLUDED.highlights,
               replay_fee_kobo = EXCLUDED.replay_fee_kobo,
               is_published = TRUE,
               published_at = NOW()
         RETURNING id, room_id, creator_id, title, highlights,
                   replay_fee_kobo::TEXT AS replay_fee_kobo,
                   is_published, published_at, created_at`,
        [
          roomId,
          userId,
          body.title,
          JSON.stringify(body.highlights),
          body.replay_fee_kobo,
        ]
      );

      return NextResponse.json(
        {
          success: true,
          data: {
            replay: {
              ...rows[0],
              replayFeeKobo: parseInt(rows[0].replay_fee_kobo, 10),
            },
          },
          error: null,
        },
        { status: 201 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);
