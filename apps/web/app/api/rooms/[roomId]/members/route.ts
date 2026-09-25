export const dynamic = 'force-dynamic';

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
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
    const orm = await getDb();

    // Verify room exists
    const [room] = await orm
      .select({ creator_id: schema.rooms.creatorId, is_active: schema.rooms.isActive })
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId))
      .limit(1);
    if (!room || !room.is_active) throw notFound("Room not found");

    const isCreator = room.creator_id === userId;

    // Verify membership
    if (!isCreator) {
      const [memberRow] = await orm
        .select({ id: schema.roomMembers.id })
        .from(schema.roomMembers)
        .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, userId)))
        .limit(1);
      if (!memberRow) {
        throw forbidden("You must be a member to view the member list");
      }
    }

    const queryParams = validateSearchParams(
      req.nextUrl.searchParams,
      listMembersQuerySchema
    );

    const rm = schema.roomMembers;
    const u = schema.users;
    const members = await orm
      .select({
        user_id: rm.userId,
        username: u.username,
        display_name: u.displayName,
        avatar_emoji: u.avatarEmoji,
        plan: u.plan,
        is_creator: u.isCreator,
        creator_tier: u.creatorTier,
        role: rm.role,
        is_muted: rm.isMuted,
        joined_at: rm.joinedAt,
      })
      .from(rm)
      .innerJoin(u, eq(u.id, rm.userId))
      .where(
        and(
          eq(rm.roomId, roomId),
          queryParams.cursor ? gt(rm.joinedAt, new Date(queryParams.cursor)) : undefined
        )
      )
      .orderBy(
        sql`CASE ${rm.role} WHEN 'admin' THEN 1 WHEN 'co_moderator' THEN 2 ELSE 3 END`,
        asc(rm.joinedAt)
      )
      .limit(queryParams.limit);

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

    const orm = await getDb();

    // Fetch room
    const [room] = await orm
      .select({ creator_id: schema.rooms.creatorId, is_active: schema.rooms.isActive })
      .from(schema.rooms)
      .where(eq(schema.rooms.id, roomId))
      .limit(1);
    if (!room || !room.is_active) throw notFound("Room not found");

    // Fetch caller's role
    const [callerRow] = await orm
      .select({ role: schema.roomMembers.role })
      .from(schema.roomMembers)
      .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, callerId)))
      .limit(1);

    const isCreator = room.creator_id === callerId;
    const callerRole = callerRow?.role;

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
    const [targetRow] = await orm
      .select({ role: schema.roomMembers.role })
      .from(schema.roomMembers)
      .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, targetUserId)))
      .limit(1);

    if (!targetRow) throw notFound("Member not found");

    // Co-moderators cannot remove other co-moderators
    if (!isCreator && targetRow.role === "co_moderator") {
      throw forbidden("Co-moderators cannot remove other co-moderators");
    }

    await orm.transaction(async (tx) => {
      await tx
        .delete(schema.roomMembers)
        .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, targetUserId)));

      await tx
        .update(schema.rooms)
        .set({
          memberCount: sql`GREATEST(${schema.rooms.memberCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(schema.rooms.id, roomId));
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleApiError(err);
  }
});
