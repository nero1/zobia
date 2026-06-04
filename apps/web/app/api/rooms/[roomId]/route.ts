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
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import {
  handleApiError,
  notFound,
  forbidden,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

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

interface RoomDetailRow {
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
}

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

    const { rows: roomRows } = await db.query<RoomDetailRow>(
      `SELECT
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
         rm.role            AS caller_role
       FROM rooms r
       JOIN users u ON u.id = r.creator_id
       LEFT JOIN room_members rm
         ON rm.room_id = r.id AND rm.user_id = $2
       WHERE r.id = $1
         AND r.is_active = TRUE`,
      [roomId, auth.user.sub]
    );

    const room = roomRows[0];
    if (!room) throw notFound("Room not found");

    // Guild rooms are restricted to Platinum-tier guilds and above
    if (room.type === "guild") {
      const { rows: guildTierRows } = await db.query<{ tier: string }>(
        `SELECT g.tier FROM guilds g
         JOIN guild_rooms gr ON gr.guild_id = g.id
         WHERE gr.room_id = $1`,
        [roomId]
      );
      const guildTier = guildTierRows[0]?.tier ?? null;
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
      const { rows: msgRows } = await db.query<RecentMessageRow>(
        `SELECT
           m.id,
           u.username       AS sender_username,
           u.avatar_emoji   AS sender_avatar_emoji,
           m.content,
           m.message_type,
           m.created_at
         FROM room_messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.room_id = $1
           AND m.is_deleted = FALSE
         ORDER BY m.created_at DESC
         LIMIT $2`,
        [roomId, messageLimit]
      );
      recentMessages = msgRows;
    }

    // Top gifter for display in header
    const { rows: topGifterRows } = await db.query<{
      user_id: string;
      username: string;
      avatar_emoji: string;
      total_coins: number;
    }>(
      `SELECT g.sender_id AS user_id, u.username, u.avatar_emoji,
              SUM(g.coin_value) AS total_coins
         FROM gifts g
         JOIN users u ON u.id = g.sender_id
         WHERE g.room_id = $1
           AND g.created_at > NOW() - INTERVAL '24 hours'
         GROUP BY g.sender_id, u.username, u.avatar_emoji
         ORDER BY total_coins DESC
         LIMIT 1`,
      [roomId]
    );

    return NextResponse.json(
      {
        room,
        isMember,
        isCreator,
        recentMessages,
        topGifter: topGifterRows[0] ?? null,
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

    // Verify ownership
    const { rows: ownerRows } = await db.query<{ creator_id: string }>(
      `SELECT creator_id FROM rooms WHERE id = $1 AND is_active = TRUE`,
      [roomId]
    );
    if (!ownerRows[0]) throw notFound("Room not found");
    if (ownerRows[0].creator_id !== auth.user.sub) {
      throw forbidden("Only the room creator can update this room");
    }

    const { rows: updatedRows } = await db.query(
      `UPDATE rooms SET
         name             = COALESCE($2, name),
         description      = COALESCE($3, description),
         category         = COALESCE($4, category),
         city             = COALESCE($5, city),
         cover_emoji      = COALESCE($6, cover_emoji),
         cover_image_url  = COALESCE($7, cover_image_url),
         updated_at       = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        roomId,
        body.name ?? null,
        body.description ?? null,
        body.category ?? null,
        body.city ?? null,
        body.coverEmoji ?? null,
        body.coverImageUrl ?? null,
      ]
    );

    return NextResponse.json({ room: updatedRows[0] }, { status: 200 });
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

    const { rows: ownerRows } = await db.query<{ creator_id: string }>(
      `SELECT creator_id FROM rooms WHERE id = $1 AND is_active = TRUE`,
      [roomId]
    );
    if (!ownerRows[0]) throw notFound("Room not found");
    if (ownerRows[0].creator_id !== auth.user.sub) {
      throw forbidden("Only the room creator can deactivate this room");
    }

    await db.query(
      `UPDATE rooms SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [roomId]
    );

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleApiError(err);
  }
});
