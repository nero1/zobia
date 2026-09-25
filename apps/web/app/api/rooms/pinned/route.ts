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
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
  const db = await getDb();
  const rows = await db
    .select({ id: schema.trackMilestoneUnlocks.id })
    .from(schema.trackMilestoneUnlocks)
    .where(
      and(
        eq(schema.trackMilestoneUnlocks.userId, userId),
        eq(schema.trackMilestoneUnlocks.track, "explorer"),
        sql`${schema.trackMilestoneUnlocks.milestoneLevel} >= 10`
      )
    )
    .limit(1);

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

    const db = await getDb();
    const conditions = [eq(schema.roomPins.userId, auth.user.sub)];
    if (query.cursor) {
      conditions.push(lt(schema.roomPins.createdAt, new Date(query.cursor)));
    }

    // Faves tab / pinned-rooms strip: this is the room-favoriting mechanism
    // (PRD §3 "Room Pins" — tiered by plan). Rows come back in the same shape
    // as GET /api/rooms so the same RoomCard renders it directly.
    const rawRows = await db
      .select({
        id: schema.rooms.id,
        name: schema.rooms.name,
        description: schema.rooms.description,
        type: schema.rooms.type,
        category: schema.rooms.category,
        city: schema.rooms.city,
        coverEmoji: schema.rooms.coverEmoji,
        coverImageUrl: schema.rooms.coverImageUrl,
        slug: schema.rooms.slug,
        creatorId: schema.rooms.creatorId,
        creatorUsername: schema.users.username,
        creatorDisplayName: schema.users.displayName,
        creatorAvatarEmoji: schema.users.avatarEmoji,
        creatorTier: schema.users.creatorTier,
        memberCount: schema.rooms.memberCount,
        maxMembers: schema.rooms.maxMembers,
        isActive: schema.rooms.isActive,
        isFeatured: schema.rooms.isFeatured,
        isSponsored: schema.rooms.isSponsored,
        subscriptionPriceNgn: schema.rooms.subscriptionPriceNgn,
        entryFeeNgn: schema.rooms.entryFeeNgn,
        dropStartsAt: schema.rooms.dropStartsAt,
        dropEndsAt: schema.rooms.dropEndsAt,
        enrolmentFeeNgn: schema.rooms.enrolmentFeeNgn,
        totalMessages: schema.rooms.totalMessages,
        healthScore: schema.rooms.healthScore,
        createdAt: schema.rooms.createdAt,
        updatedAt: schema.rooms.updatedAt,
        pinnedAt: schema.roomPins.createdAt,
      })
      .from(schema.roomPins)
      .innerJoin(schema.rooms, eq(schema.rooms.id, schema.roomPins.roomId))
      .innerJoin(schema.users, eq(schema.users.id, schema.rooms.creatorId))
      .where(and(...conditions))
      .orderBy(desc(schema.roomPins.createdAt))
      .limit(query.limit);

    const rows: Array<RoomCardSourceRow & { pinned_at: string }> = rawRows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      type: r.type,
      category: r.category,
      city: r.city,
      cover_emoji: r.coverEmoji,
      cover_image_url: r.coverImageUrl,
      slug: r.slug,
      creator_id: r.creatorId,
      creator_username: r.creatorUsername,
      creator_display_name: r.creatorDisplayName,
      creator_avatar_emoji: r.creatorAvatarEmoji,
      creator_tier: r.creatorTier,
      member_count: r.memberCount,
      max_members: r.maxMembers,
      is_active: r.isActive ?? true,
      is_featured: r.isFeatured,
      is_sponsored: r.isSponsored,
      subscription_price_ngn: r.subscriptionPriceNgn === null ? null : Number(r.subscriptionPriceNgn),
      entry_fee_ngn: r.entryFeeNgn === null ? null : Number(r.entryFeeNgn),
      drop_starts_at: r.dropStartsAt ? r.dropStartsAt.toISOString() : null,
      drop_ends_at: r.dropEndsAt ? r.dropEndsAt.toISOString() : null,
      enrolment_fee_ngn: r.enrolmentFeeNgn === null ? null : Number(r.enrolmentFeeNgn),
      total_messages: r.totalMessages,
      health_score: r.healthScore ?? 100,
      created_at: r.createdAt ? r.createdAt.toISOString() : "",
      updated_at: r.updatedAt ? r.updatedAt.toISOString() : "",
      pinned_at: r.pinnedAt ? r.pinnedAt.toISOString() : "",
    }));

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

    const db = await getDb();

    // Verify room exists
    const [roomRow] = await db
      .select({ id: schema.rooms.id })
      .from(schema.rooms)
      .where(eq(schema.rooms.id, body.roomId))
      .limit(1);
    if (!roomRow) throw notFound("Room not found");

    // Get user plan
    const [userRow] = await db
      .select({ plan: schema.users.plan })
      .from(schema.users)
      .where(eq(schema.users.id, auth.user.sub))
      .limit(1);
    const plan = (userRow?.plan as Plan) ?? "free";

    // Count current pins
    const [countRow] = await db
      .select({ count: sql<string>`COUNT(*)` })
      .from(schema.roomPins)
      .where(eq(schema.roomPins.userId, auth.user.sub));
    const currentCount = parseInt(countRow?.count ?? "0", 10);
    const limit = await getEffectivePinLimit(auth.user.sub, plan);

    if (currentCount >= limit) {
      throw badRequest(
        `You've reached your Room Pin limit (${limit}) for your plan. Upgrade or unpin a room to add more.`
      );
    }

    // Check not already pinned
    const [existsRow] = await db
      .select({ id: schema.roomPins.id })
      .from(schema.roomPins)
      .where(and(eq(schema.roomPins.userId, auth.user.sub), eq(schema.roomPins.roomId, body.roomId)))
      .limit(1);
    if (existsRow) {
      throw badRequest("Room is already pinned");
    }

    // Insert pin
    const [insertRow] = await db
      .insert(schema.roomPins)
      .values({ userId: auth.user.sub, roomId: body.roomId })
      .returning({ id: schema.roomPins.id, createdAt: schema.roomPins.createdAt });

    return NextResponse.json(
      {
        success: true,
        data: {
          pinId: insertRow.id,
          pinnedAt: insertRow.createdAt ? insertRow.createdAt.toISOString() : null,
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

    const db = await getDb();
    const rows = await db
      .delete(schema.roomPins)
      .where(and(eq(schema.roomPins.userId, auth.user.sub), eq(schema.roomPins.roomId, body.roomId)))
      .returning({ id: schema.roomPins.id });

    if (rows.length === 0) throw notFound("Pin not found");

    return NextResponse.json({ success: true, data: null, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
