export const dynamic = 'force-dynamic';

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
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
      const orm = await getDb();
      const [replayRow] = await orm
        .select({
          id: schema.dropRoomReplays.id,
          room_id: schema.dropRoomReplays.roomId,
          creator_id: schema.dropRoomReplays.creatorId,
          title: schema.dropRoomReplays.title,
          highlights: schema.dropRoomReplays.highlights,
          replay_fee_kobo: schema.dropRoomReplays.replayFeeKobo,
          is_published: schema.dropRoomReplays.isPublished,
          published_at: schema.dropRoomReplays.publishedAt,
          created_at: schema.dropRoomReplays.createdAt,
        })
        .from(schema.dropRoomReplays)
        .where(eq(schema.dropRoomReplays.roomId, roomId))
        .limit(1);

      if (!replayRow) throw notFound("Replay not found for this room");
      const replay = { ...replayRow, replay_fee_kobo: replayRow.replay_fee_kobo.toString() };

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
        const [accessRow] = await orm
          .select({ id: schema.coinLedger.id })
          .from(schema.coinLedger)
          .where(
            and(
              eq(schema.coinLedger.userId, userId),
              eq(schema.coinLedger.referenceId, replay.id),
              eq(schema.coinLedger.transactionType, "replay_access")
            )
          )
          .limit(1);
        hasPurchased = !!accessRow;
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
      const orm = await getDb();
      const [roomRow] = await orm
        .select({ creator_id: schema.rooms.creatorId, type: schema.rooms.type })
        .from(schema.rooms)
        .where(eq(schema.rooms.id, roomId))
        .limit(1);
      if (!roomRow) throw notFound("Room not found");
      if (roomRow.creator_id !== userId) {
        throw forbidden("Only the room creator can publish a replay");
      }
      if (roomRow.type !== "drop") {
        throw forbidden("Replays are only available for Drop rooms");
      }

      const body = await validateBody(req, createReplaySchema);

      const [replayRow] = await orm
        .insert(schema.dropRoomReplays)
        .values({
          roomId,
          creatorId: userId,
          title: body.title,
          highlights: body.highlights,
          replayFeeKobo: BigInt(body.replay_fee_kobo),
          isPublished: true,
          publishedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.dropRoomReplays.roomId,
          set: {
            title: body.title,
            highlights: body.highlights,
            replayFeeKobo: BigInt(body.replay_fee_kobo),
            isPublished: true,
            publishedAt: new Date(),
          },
        })
        .returning({
          id: schema.dropRoomReplays.id,
          room_id: schema.dropRoomReplays.roomId,
          creator_id: schema.dropRoomReplays.creatorId,
          title: schema.dropRoomReplays.title,
          highlights: schema.dropRoomReplays.highlights,
          replay_fee_kobo: schema.dropRoomReplays.replayFeeKobo,
          is_published: schema.dropRoomReplays.isPublished,
          published_at: schema.dropRoomReplays.publishedAt,
          created_at: schema.dropRoomReplays.createdAt,
        });

      return NextResponse.json(
        {
          success: true,
          data: {
            replay: {
              ...replayRow,
              replay_fee_kobo: replayRow.replay_fee_kobo.toString(),
              replayFeeKobo: Number(replayRow.replay_fee_kobo),
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
