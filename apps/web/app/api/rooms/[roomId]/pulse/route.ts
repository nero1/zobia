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
import { getRoomPresenceCount } from "@/lib/presence/room";
import { loadManifest } from "@/lib/manifest";
import { resolveRoomCap } from "@/lib/rooms/capacity";

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface RoomPulseRow {
  member_count: number;
  max_members: number | null;
  type: string;
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
      `SELECT member_count, max_members, type, is_active
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

    // Prefer the live presence count (who is viewing right now); fall back to the
    // denormalised membership count when presence is empty/unavailable.
    const manifest = await loadManifest();
    const cap = resolveRoomCap(room.type, room.max_members, manifest);
    const presentCount = await getRoomPresenceCount(roomId);

    return NextResponse.json(
      {
        roomId,
        activeCount: presentCount > 0 ? presentCount : room.member_count,
        presentCount,
        maxCapacity: cap,
        messagesLastHour: msgRows[0]?.count ?? 0,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
