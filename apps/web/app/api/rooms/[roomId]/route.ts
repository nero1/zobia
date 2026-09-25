export const dynamic = 'force-dynamic';

/**
 * app/api/rooms/[roomId]/route.ts
 *
 * Room detail, update, and deactivation endpoints.
 *
 * GET /api/rooms/:roomId
 *   Returns full room details including member count and recent message preview.
 *   Non-members can see public info but not message content for VIP/Drop rooms.
 *
 * PUT /api/rooms/:roomId
 *   Update room metadata. Creator only.
 *
 * DELETE /api/rooms/:roomId
 *   Soft-deactivate a room (sets is_active = FALSE). Creator only.
 *
 * NOTE: `rooms.is_suspended` / `rooms.is_banned` and the `room_visits` table
 * are not present in lib/db/schema.ts's rooms table (schema/DB mismatch —
 * reported upstream; users has same-named is_suspended/is_banned columns,
 * but rooms does not), so those specific reads/writes use Drizzle's `sql`
 * tag directly rather than the query builder.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import {
  handleApiError,
  notFound,
  forbidden,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const updateRoomSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  description: z.string().max(500).optional(),
  category: z.string().min(1).max(50).optional(),
  city: z.string().max(100).optional(),
  coverEmoji: z.string().max(10).optional(),
  coverImageUrl: z.string().url().optional().nullable(),
  isPublic: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

type RoomDetailRow = Record<string, unknown> & {
  id: string;
  name: string;
  description: string | null;
  type: string;
  category: string;
  city: string | null;
  cover_emoji: string;
  cover_image_url: string | null;
  creator_id: string;
  creator_username: string;
  creator_display_name: string;
  creator_avatar_emoji: string;
  is_suspended: boolean;
  is_banned: boolean;
  creator_tier: string | null;
  member_count: number;
  max_members: number | null;
  is_active: boolean;
  is_featured: boolean;
  is_sponsored: boolean;
  subscription_price_ngn: number | null;
  entry_fee_ngn: number | null;
  drop_starts_at: string | null;
  drop_ends_at: string | null;
  enrolment_fee_ngn: number | null;
  curriculum: unknown | null;
  class_start_date: string | null;
  class_end_date: string | null;
  total_messages: number;
  health_score: number;
  created_at: string;
  updated_at: string;
  /** Caller's membership role; null if not a member. */
  caller_role: string | null;
};

interface RecentMessageRow {
  id: string;
  sender_username: string;
  sender_avatar_emoji: string;
  content: string | null;
  message_type: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/rooms/[roomId]
// ---------------------------------------------------------------------------

/**
 * Fetch full room details including member count and recent message preview.
 *
 * The `recentMessages` field is omitted for VIP/Drop rooms if the caller
 * is not a subscribed/paid member (non-members see last 3 public messages only
 * for VIP rooms per PRD).
 *
 * @param req     - Incoming request
 * @param params  - Route params containing roomId
 * @returns Room detail object with optional recentMessages array
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { roomId } = await params as { roomId: string };
    const orm = await getDb();

    const result = await orm.execute<RoomDetailRow & { is_admin: boolean }>(sql`
      SELECT
        r.id,
        r.name,
        r.description,
        r.type,
        r.category,
        r.city,
        r.cover_emoji,
        r.cover_image_url,
        r.creator_id,
        u.username        AS creator_username,
        u.display_name    AS creator_display_name,
        u.avatar_emoji    AS creator_avatar_emoji,
        u.creator_tier,
        r.member_count,
        r.max_members,
        r.is_active,
        r.is_featured,
        r.is_sponsored,
        r.subscription_price_ngn,
        r.entry_fee_ngn,
        r.drop_starts_at,
        r.drop_ends_at,
        r.enrolment_fee_ngn,
        r.curriculum,
        r.class_start_date,
        r.class_end_date,
        r.total_messages,
        r.health_score,
        r.created_at,
        r.updated_at,
        rm.role            AS caller_role,
        COALESCE(r.is_suspended, FALSE) AS is_suspended,
        COALESCE(r.is_banned, FALSE)    AS is_banned,
        COALESCE(caller.is_admin, FALSE) AS is_admin
      FROM rooms r
      JOIN users u ON u.id = r.creator_id
      LEFT JOIN room_members rm
        ON rm.room_id = r.id AND rm.user_id = ${auth.user.sub}
      LEFT JOIN users caller ON caller.id = ${auth.user.sub}
      WHERE r.id = ${roomId}
        AND r.is_active = TRUE
    `);

    const room = result.rows[0];
    if (!room) throw notFound("Room not found");
    if (room.is_banned) throw forbidden("This room has been permanently banned");
    if (room.is_suspended) throw forbidden("This room is currently suspended");

    // Guild rooms are restricted to Platinum-tier guilds and above.
    // Admins bypass this gate entirely — they can open and moderate any room.
    if (room.type === "guild" && !room.is_admin) {
      const [guildTierRow] = await orm
        .select({ tier: schema.guilds.tier })
        .from(schema.guilds)
        .innerJoin(schema.guildRooms, eq(schema.guildRooms.guildId, schema.guilds.id))
        .where(eq(schema.guildRooms.roomId, roomId));
      const guildTier = guildTierRow?.tier ?? null;
      const platinumAndAbove = ["platinum_1", "platinum_2", "platinum_3", "legend"];
      if (!guildTier || !platinumAndAbove.includes(guildTier)) {
        throw forbidden("Guild Rooms are only available to Platinum-tier Guilds and above.");
      }
    }

    const isMember = room.caller_role !== null;
    const isCreator = room.creator_id === auth.user.sub;

    // Decide whether to include message previews
    let showMessages = isMember || isCreator;

    // VIP: non-subscribers see last 3 public messages
    let messageLimit = 20;
    if (room.type === "vip" && !isMember && !isCreator) {
      showMessages = true;
      messageLimit = 3;
    }

    let recentMessages: RecentMessageRow[] = [];
    if (showMessages) {
      const msgRows = await orm
        .select({
          id: schema.roomMessages.id,
          sender_username: schema.users.username,
          sender_avatar_emoji: schema.users.avatarEmoji,
          content: schema.roomMessages.content,
          message_type: schema.roomMessages.messageType,
          created_at: schema.roomMessages.createdAt,
        })
        .from(schema.roomMessages)
        .innerJoin(schema.users, eq(schema.users.id, schema.roomMessages.senderId))
        .where(and(eq(schema.roomMessages.roomId, roomId), eq(schema.roomMessages.isDeleted, false)))
        .orderBy(sql`${schema.roomMessages.createdAt} DESC`)
        .limit(messageLimit);
      recentMessages = msgRows as unknown as RecentMessageRow[];
    }

    // Top gifter for display in header
    const topGifterResult = await orm.execute<{
      user_id: string;
      username: string;
      avatar_emoji: string;
      total_coins: string;
    }>(sql`
      SELECT g.sender_id AS user_id, u.username, u.avatar_emoji,
             SUM(g.coin_value) AS total_coins
        FROM gifts g
        JOIN users u ON u.id = g.sender_id
        WHERE g.room_id = ${roomId}
          AND g.created_at > NOW() - INTERVAL '24 hours'
        GROUP BY g.sender_id, u.username, u.avatar_emoji
        ORDER BY total_coins DESC
        LIMIT 1
    `);

    // Record this open for the "Recently Visited" discovery tab. Fire-and-forget
    // — a visit-tracking failure must never break the room detail response.
    orm.execute(sql`
      INSERT INTO room_visits (user_id, room_id, last_visited_at)
      VALUES (${auth.user.sub}, ${roomId}, NOW())
      ON CONFLICT (user_id, room_id) DO UPDATE SET last_visited_at = NOW()
    `).catch((err: unknown) => {
      logger.warn({ err, roomId, userId: auth.user.sub }, "[rooms] failed to record room visit");
    });

    return NextResponse.json(
      {
        room,
        isMember,
        isCreator,
        recentMessages,
        topGifter: topGifterResult.rows[0] ?? null,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/rooms/[roomId]
// ---------------------------------------------------------------------------

/**
 * Update room metadata. Only the room creator may update.
 *
 * @param req    - Incoming request with JSON body
 * @param params - Route params containing roomId
 * @returns Updated room object
 */
export const PUT = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { roomId } = await params as { roomId: string };
    const body = await validateBody(req, updateRoomSchema);
    const orm = await getDb();

    // Verify ownership
    const [owner] = await orm
      .select({ creatorId: schema.rooms.creatorId })
      .from(schema.rooms)
      .where(and(eq(schema.rooms.id, roomId), eq(schema.rooms.isActive, true)))
      .limit(1);
    if (!owner) throw notFound("Room not found");
    if (owner.creatorId !== auth.user.sub) {
      throw forbidden("Only the room creator can update this room");
    }

    const [updatedRoom] = await orm
      .update(schema.rooms)
      .set({
        name: body.name ?? undefined,
        description: body.description ?? undefined,
        category: body.category ?? undefined,
        city: body.city ?? undefined,
        coverEmoji: body.coverEmoji ?? undefined,
        coverImageUrl: body.coverImageUrl !== undefined ? body.coverImageUrl : undefined,
        updatedAt: sql`NOW()`,
      })
      .where(eq(schema.rooms.id, roomId))
      .returning();

    return NextResponse.json({ room: updatedRoom }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/rooms/[roomId]
// ---------------------------------------------------------------------------

/**
 * Soft-deactivate a room (sets is_active = FALSE). Creator only.
 *
 * Members are not kicked; they simply can no longer send messages or
 * receive new ones. The room data is retained for audit purposes.
 *
 * @param req    - Incoming request
 * @param params - Route params containing roomId
 * @returns 204 No Content on success
 */
export const DELETE = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { roomId } = await params as { roomId: string };
    const orm = await getDb();

    const [owner] = await orm
      .select({ creatorId: schema.rooms.creatorId, createdAt: schema.rooms.createdAt })
      .from(schema.rooms)
      .where(and(eq(schema.rooms.id, roomId), eq(schema.rooms.isActive, true)))
      .limit(1);
    if (!owner) throw notFound("Room not found");
    if (owner.creatorId !== auth.user.sub) {
      throw forbidden("Only the room creator can deactivate this room");
    }

    await orm
      .update(schema.rooms)
      .set({ isActive: false, updatedAt: sql`NOW()` })
      .where(eq(schema.rooms.id, roomId));

    // PRD §6: Award 50 XP (creator track) if creator hosted for 30+ minutes
    const sessionMinutes = owner.createdAt
      ? (Date.now() - new Date(owner.createdAt).getTime()) / 60000
      : 0;
    if (sessionMinutes >= 30) {
      orm.insert(schema.xpEvents).values({
        userId: auth.user.sub,
        action: 'host_room_session_30_min',
        xpAwarded: 50,
        track: 'creator',
        metadata: { roomId, sessionMinutes: Math.floor(sessionMinutes) },
      }).then(() =>
        orm
          .update(schema.users)
          .set({ xpTotal: sql`${schema.users.xpTotal} + 50`, xpCreator: sql`${schema.users.xpCreator} + 50`, updatedAt: sql`NOW()` })
          .where(eq(schema.users.id, auth.user.sub))
      ).catch((err: unknown) => logger.error({ err: err }, "[rooms/delete] host_room_session_30_min XP failed:"))
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleApiError(err);
  }
});
