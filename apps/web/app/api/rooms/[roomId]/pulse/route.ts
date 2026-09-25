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
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

    const orm = await getDb();
    const [room] = await orm
      .select({
        member_count: schema.rooms.memberCount,
        max_members: schema.rooms.maxMembers,
        type: schema.rooms.type,
        is_active: schema.rooms.isActive,
      })
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId))
      .limit(1);
    if (!room || !room.is_active) throw notFound("Room not found");

    const [msgRow] = await orm
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.roomMessages)
      .where(
        and(
          eq(schema.roomMessages.roomId, roomId),
          gt(schema.roomMessages.createdAt, sql`NOW() - INTERVAL '1 hour'`),
          eq(schema.roomMessages.isDeleted, false)
        )
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
        messagesLastHour: msgRow?.count ?? 0,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
