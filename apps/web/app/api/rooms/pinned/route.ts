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
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import type { Plan } from "@zobia/types";

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

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    interface PinnedRoomRow {
      pin_id: string;
      pinned_at: string;
      room_id: string;
      name: string;
      description: string | null;
      room_type: string;
      member_count: number;
      creator_id: string;
      creator_name: string;
      creator_avatar: string;
    }

    const { rows } = await db.query<PinnedRoomRow>(
      `SELECT
         rp.id          AS pin_id,
         rp.created_at  AS pinned_at,
         r.id           AS room_id,
         r.name,
         r.description,
         r.room_type,
         r.member_count,
         u.id           AS creator_id,
         u.display_name AS creator_name,
         u.avatar_emoji AS creator_avatar
       FROM room_pins rp
       JOIN rooms r ON r.id = rp.room_id
       JOIN users u ON u.id = r.creator_id
       WHERE rp.user_id = $1
       ORDER BY rp.created_at DESC`,
      [auth.user.sub]
    );

    return NextResponse.json({
      success: true,
      data: rows.map((row) => ({
        pinId: row.pin_id,
        pinnedAt: row.pinned_at,
        room: {
          id: row.room_id,
          name: row.name,
          description: row.description,
          roomType: row.room_type,
          memberCount: row.member_count,
          creator: {
            id: row.creator_id,
            displayName: row.creator_name,
            avatarEmoji: row.creator_avatar,
          },
        },
      })),
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/rooms/pinned
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { auth }) => {
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

export const DELETE = withAuth(async (req: NextRequest, { auth }) => {
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
