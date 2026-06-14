export const dynamic = 'force-dynamic';

/**
 * app/api/rooms/[roomId]/pulse/route.ts
 *
 * GET /api/rooms/:roomId/pulse
 *
 * Lightweight endpoint returning a room's current activity snapshot.
 * Any authenticated user may call it.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface RoomPulseRow {
  member_count: number;
  max_members: number | null;
  is_active: boolean;
}

interface MessagesLastHourRow {
  count: number;
}

// ---------------------------------------------------------------------------
// GET /api/rooms/[roomId]/pulse
// ---------------------------------------------------------------------------

export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { roomId } = await params as { roomId: string };

    if (!roomId || roomId === "undefined") throw notFound("Room not found");

    const { rows: roomRows } = await db.query<RoomPulseRow>(
      `SELECT member_count, max_members, is_active
       FROM rooms WHERE id = $1`,
      [roomId]
    );

    const room = roomRows[0];
    if (!room || !room.is_active) throw notFound("Room not found");

    const { rows: msgRows } = await db.query<MessagesLastHourRow>(
      `SELECT COUNT(*)::int AS count
       FROM room_messages
       WHERE room_id = $1
         AND created_at > NOW() - INTERVAL '1 hour'
         AND is_deleted = FALSE`,
      [roomId]
    );

    return NextResponse.json(
      {
        roomId,
        activeCount: room.member_count,
        maxCapacity: room.max_members ?? 10000,
        messagesLastHour: msgRows[0]?.count ?? 0,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
