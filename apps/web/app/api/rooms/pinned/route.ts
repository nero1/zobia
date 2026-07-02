export const dynamic = 'force-dynamic';

/**
 * app/api/rooms/pinned/route.ts
 *
 * Pinned Rooms — user bookmarks for quick access.
 *
 * GET  /api/rooms/pinned          – list user's pinned rooms (full room data)
 * POST /api/rooms/pinned          – pin a room  { roomId }
 * DELETE /api/rooms/pinned        – unpin a room { roomId }
 *
 * Pin limits by plan (PRD §3):
 *   Free = 3  |  Plus = 4  |  Pro = 5  |  Max = 10
 *
 * Explorer Track Level 10 ("Wanderer") override:
 *   Users who have unlocked the Explorer L10 milestone get a minimum of 5 pins
 *   regardless of plan (i.e., the effective limit = max(planLimit, 5)).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, type SqlParam } from "@/lib/db";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import type { Plan } from "@zobia/types";
import { toRoomCardPayload, type RoomCardSourceRow } from "@/lib/rooms/serialize";

// ---------------------------------------------------------------------------
// Pin limits
// ---------------------------------------------------------------------------

const PLAN_PIN_LIMITS: Record<Plan, number> = {
  free:  3,
  plus:  4,
  pro:   5,
  max:   10,
};

/** Explorer Track Level 10 ("Wanderer") minimum pin count override. */
const EXPLORER_L10_MIN_PINS = 5;

async function getEffectivePinLimit(userId: string, plan: Plan): Promise<number> {
  const base = PLAN_PIN_LIMITS[plan] ?? 3;

  // Check Explorer L10 milestone unlock
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM track_milestone_unlocks
     WHERE user_id = $1 AND track = 'explorer' AND milestone_level >= 10
     LIMIT 1`,
    [userId]
  );

  const hasWanderer = rows.length > 0;
  return hasWanderer ? Math.max(base, EXPLORER_L10_MIN_PINS) : base;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const pinSchema = z.object({
  roomId: z.string().uuid("roomId must be a valid UUID"),
});

// ---------------------------------------------------------------------------
// GET /api/rooms/pinned
// ---------------------------------------------------------------------------

const listPinnedQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 50) : 20)),
});

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const query = validateSearchParams(req.nextUrl.searchParams, listPinnedQuerySchema);

    const queryParams: SqlParam[] = [auth.user.sub];
    let cursorClause = "";
    if (query.cursor) {
      queryParams.push(query.cursor);
      cursorClause = `AND rp.created_at < $${queryParams.length}`;
    }
    queryParams.push(query.limit);
    const limitParam = queryParams.length;

    // Faves tab / pinned-rooms strip: this is the room-favoriting mechanism
    // (PRD §3 "Room Pins" — tiered by plan). Rows come back in the same shape
    // as GET /api/rooms so the same RoomCard renders it directly.
    const { rows } = await db.query<RoomCardSourceRow & { pinned_at: string }>(
      `SELECT
         r.id, r.name, r.description, r.type, r.category, r.city,
         r.cover_emoji, r.cover_image_url, r.slug,
         r.creator_id, u.username AS creator_username, u.display_name AS creator_display_name,
         u.avatar_emoji AS creator_avatar_emoji, u.creator_tier,
         r.member_count, r.max_members, r.is_active, r.is_featured, r.is_sponsored,
         r.subscription_price_ngn, r.entry_fee_ngn, r.drop_starts_at, r.drop_ends_at,
         r.enrolment_fee_ngn, r.total_messages, COALESCE(r.health_score, 100) AS health_score,
         r.created_at, r.updated_at,
         rp.created_at AS pinned_at
       FROM room_pins rp
       JOIN rooms r ON r.id = rp.room_id
       JOIN users u ON u.id = r.creator_id
       WHERE rp.user_id = $1 ${cursorClause}
       ORDER BY rp.created_at DESC
       LIMIT $${limitParam}`,
      queryParams
    );

    const nextCursor =
      rows.length === query.limit ? rows[rows.length - 1]?.pinned_at ?? null : null;

    const rooms = rows.map((row) =>
      toRoomCardPayload(row, { isJoined: false, isFavorited: true })
    );

    return NextResponse.json({
      success: true,
      rooms,
      data: { rooms, nextCursor, hasMore: nextCursor !== null },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/rooms/pinned
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const body = await validateBody(req, pinSchema);

    // Verify room exists
    const { rows: roomRows } = await db.query<{ id: string }>(
      "SELECT id FROM rooms WHERE id = $1 LIMIT 1",
      [body.roomId]
    );
    if (roomRows.length === 0) throw notFound("Room not found");

    // Get user plan
    const { rows: userRows } = await db.query<{ plan: Plan }>(
      "SELECT plan FROM users WHERE id = $1 LIMIT 1",
      [auth.user.sub]
    );
    const plan = (userRows[0]?.plan as Plan) ?? "free";

    // Count current pins
    const { rows: countRows } = await db.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM room_pins WHERE user_id = $1",
      [auth.user.sub]
    );
    const currentCount = parseInt(countRows[0]?.count ?? "0", 10);
    const limit = await getEffectivePinLimit(auth.user.sub, plan);

    if (currentCount >= limit) {
      throw badRequest(
        `You've reached your Room Pin limit (${limit}) for your plan. Upgrade or unpin a room to add more.`
      );
    }

    // Check not already pinned
    const { rows: existsRows } = await db.query<{ id: string }>(
      "SELECT id FROM room_pins WHERE user_id = $1 AND room_id = $2 LIMIT 1",
      [auth.user.sub, body.roomId]
    );
    if (existsRows.length > 0) {
      throw badRequest("Room is already pinned");
    }

    // Insert pin
    const { rows: insertRows } = await db.query<{ id: string; created_at: string }>(
      `INSERT INTO room_pins (user_id, room_id) VALUES ($1, $2)
       RETURNING id, created_at`,
      [auth.user.sub, body.roomId]
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          pinId: insertRows[0].id,
          pinnedAt: insertRows[0].created_at,
          roomId: body.roomId,
          pinsUsed: currentCount + 1,
          pinsLimit: limit,
        },
        error: null,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/rooms/pinned
// ---------------------------------------------------------------------------

export const DELETE = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const body = await validateBody(req, pinSchema);

    const { rows } = await db.query<{ id: string }>(
      "DELETE FROM room_pins WHERE user_id = $1 AND room_id = $2 RETURNING id",
      [auth.user.sub, body.roomId]
    );

    if (rows.length === 0) throw notFound("Pin not found");

    return NextResponse.json({ success: true, data: null, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
