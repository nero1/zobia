/**
 * app/api/rooms/[roomId]/members/route.ts
 *
 * Room member management endpoints.
 *
 * GET /api/rooms/:roomId/members
 *   Paginated list of room members. Caller must be a member or creator.
 *
 * DELETE /api/rooms/:roomId/members/:userId
 *   Remove a member from the room. Creator or co-moderator only.
 *   The dynamic userId segment is read from the request URL query param to
 *   keep this file as a single route handler.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, SqlParam } from "@/lib/db";
import { withAuth, validateSearchParams } from "@/lib/api/middleware";
import {
  handleApiError,
  notFound,
  forbidden,
  badRequest,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const listMembersQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 100) : 30)),
  /** For DELETE via query param: the user ID to remove */
  removeUserId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface MemberRow {
  user_id: string;
  username: string;
  display_name: string;
  avatar_emoji: string;
  plan: string;
  is_creator: boolean;
  creator_tier: string | null;
  role: string;
  is_muted: boolean;
  joined_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/rooms/[roomId]/members
// ---------------------------------------------------------------------------

/**
 * Return a paginated list of room members.
 *
 * Sorted by role (admin first) then join date ascending.
 * Caller must be a member or the room creator.
 *
 * @param req    - Incoming request with optional cursor/limit params
 * @param params - Route params containing roomId
 * @returns Paginated members list with nextCursor
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { roomId } = await params as { roomId: string };
    const userId = auth.user.sub;

    // Verify room exists
    const { rows: roomRows } = await db.query<{
      creator_id: string;
      is_active: boolean;
    }>(
      `SELECT creator_id, is_active FROM rooms WHERE id = $1`,
      [roomId]
    );
    const room = roomRows[0];
    if (!room || !room.is_active) throw notFound("Room not found");

    const isCreator = room.creator_id === userId;

    // Verify membership
    if (!isCreator) {
      const { rows: memberRows } = await db.query<{ id: string }>(
        `SELECT id FROM room_members WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
        [roomId, userId]
      );
      if (memberRows.length === 0) {
        throw forbidden("You must be a member to view the member list");
      }
    }

    const queryParams = validateSearchParams(
      req.nextUrl.searchParams,
      listMembersQuerySchema
    );

    const args: SqlParam[] = [roomId];
    let paramIdx = 2;
    let cursorClause = "";

    if (queryParams.cursor) {
      cursorClause = `AND rm.joined_at > $${paramIdx++}`;
      args.push(queryParams.cursor);
    }

    args.push(queryParams.limit);
    const limitParam = paramIdx;

    const { rows: members } = await db.query<MemberRow>(
      `SELECT
         rm.user_id,
         u.username,
         u.display_name,
         u.avatar_emoji,
         u.plan,
         u.is_creator,
         u.creator_tier,
         rm.role,
         rm.is_muted,
         rm.joined_at
       FROM room_members rm
       JOIN users u ON u.id = rm.user_id
       WHERE rm.room_id = $1
         ${cursorClause}
       ORDER BY
         CASE rm.role
           WHEN 'admin'        THEN 1
           WHEN 'co_moderator' THEN 2
           ELSE 3
         END,
         rm.joined_at ASC
       LIMIT $${limitParam}`,
      args
    );

    const nextCursor =
      members.length === queryParams.limit
        ? (members[members.length - 1]?.joined_at ?? null)
        : null;

    return NextResponse.json(
      { items: members, nextCursor, hasMore: nextCursor !== null },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/rooms/[roomId]/members?removeUserId=:userId
// ---------------------------------------------------------------------------

/**
 * Remove a member from the room.
 *
 * Only the room creator or a co-moderator may remove members.
 * A creator cannot be removed. Co-moderators cannot remove the creator or
 * other co-moderators.
 *
 * @param req    - Incoming request with removeUserId in query params
 * @param params - Route params containing roomId
 * @returns 204 No Content on success
 */
export const DELETE = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { roomId } = await params as { roomId: string };
    const callerId = auth.user.sub;

    const searchParams = validateSearchParams(
      req.nextUrl.searchParams,
      listMembersQuerySchema
    );

    const targetUserId = searchParams.removeUserId;
    if (!targetUserId) {
      throw badRequest("removeUserId query param is required");
    }

    // Fetch room
    const { rows: roomRows } = await db.query<{
      creator_id: string;
      is_active: boolean;
    }>(
      `SELECT creator_id, is_active FROM rooms WHERE id = $1`,
      [roomId]
    );
    const room = roomRows[0];
    if (!room || !room.is_active) throw notFound("Room not found");

    // Fetch caller's role
    const { rows: callerRows } = await db.query<{ role: string }>(
      `SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
      [roomId, callerId]
    );

    const isCreator = room.creator_id === callerId;
    const callerRole = callerRows[0]?.role;

    if (!isCreator && callerRole !== "co_moderator") {
      throw forbidden(
        "Only the creator or a co-moderator can remove members"
      );
    }

    // Cannot remove the creator
    if (targetUserId === room.creator_id) {
      throw forbidden("The room creator cannot be removed");
    }

    // Fetch target's role
    const { rows: targetRows } = await db.query<{ role: string }>(
      `SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
      [roomId, targetUserId]
    );

    if (targetRows.length === 0) throw notFound("Member not found");

    // Co-moderators cannot remove other co-moderators
    if (!isCreator && targetRows[0].role === "co_moderator") {
      throw forbidden("Co-moderators cannot remove other co-moderators");
    }

    await db.transaction(async (tx) => {
      await tx.query(
        `DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`,
        [roomId, targetUserId]
      );

      await tx.query(
        `UPDATE rooms
         SET member_count = GREATEST(member_count - 1, 0), updated_at = NOW()
         WHERE id = $1`,
        [roomId]
      );
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleApiError(err);
  }
});
