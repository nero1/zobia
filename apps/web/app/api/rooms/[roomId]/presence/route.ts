export const dynamic = "force-dynamic";

/**
 * app/api/rooms/[roomId]/presence/route.ts
 *
 * POST /api/rooms/:roomId/presence
 *
 * Live-presence heartbeat + soft-cap admission. Clients call this on entering a
 * room and then every ~45s while viewing it. Presence is tracked in Redis with
 * a short TTL, so a slot frees automatically when the user closes the tab/app or
 * goes idle — no explicit "Leave" needed.
 *
 * Soft cap: the room creator and moderators always get in; everyone else is
 * admitted only while the live count is below the room's effective cap
 * (per-room `max_members` override, else the manifest default for the type).
 *
 * Response (always 200 so heartbeats never error):
 *   { admitted: boolean, full: boolean, presentCount: number, cap: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";
import { resolveRoomCap } from "@/lib/rooms/capacity";
import { admitRoomPresence } from "@/lib/presence/room";

interface RoomRow {
  creator_id: string;
  type: string;
  max_members: number | null;
  is_active: boolean;
}

const PRIVILEGED_ROLES = new Set(["creator", "moderator", "co_moderator"]);

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { roomId } = (await params) as { roomId: string };
    if (!roomId || roomId === "undefined") throw badRequest("roomId is required");

    const userId = auth.user.sub;

    const { rows } = await db.query<RoomRow>(
      `SELECT creator_id, type, max_members, is_active FROM rooms WHERE id = $1`,
      [roomId],
    );
    const room = rows[0];
    if (!room || !room.is_active) throw notFound("Room not found");

    // Privileged = creator or a (co-)moderator — these always bypass the cap.
    let privileged = room.creator_id === userId;
    if (!privileged) {
      const { rows: memberRows } = await db.query<{ role: string }>(
        `SELECT role FROM room_members
         WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL
         LIMIT 1`,
        [roomId, userId],
      );
      privileged = memberRows.length > 0 && PRIVILEGED_ROLES.has(memberRows[0].role);
    }

    const manifest = await loadManifest();
    const cap = resolveRoomCap(room.type, room.max_members, manifest);

    const { admitted, count } = await admitRoomPresence(roomId, userId, cap, privileged);

    return NextResponse.json(
      { admitted, full: !admitted, presentCount: count, cap },
      { status: 200 },
    );
  } catch (err) {
    return handleApiError(err);
  }
});
