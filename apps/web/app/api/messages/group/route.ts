/**
 * app/api/messages/group/route.ts
 *
 * Group chat management endpoints.
 *
 * POST /api/messages/group — Create a new group chat
 *   - Creator becomes the first admin member
 *   - Enforces max 300 members (standard plan)
 *
 * GET /api/messages/group — List group chats the current user belongs to
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum members in a standard group chat. */
const MAX_GROUP_MEMBERS = 300;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createGroupSchema = z.object({
  name: z
    .string()
    .min(1, "Group name is required")
    .max(100, "Group name cannot exceed 100 characters"),
  avatarEmoji: z
    .string()
    .min(1, "Avatar emoji is required")
    .max(10, "Avatar emoji must be at most 10 characters")
    .default("💬"),
  tag: z.enum(["Study Group", "Crew", "Business"]).optional(),
  /** Initial member IDs to add (excluding the creator, who is added automatically). */
  memberIds: z
    .array(z.string().uuid())
    .max(299, "Cannot add more than 299 initial members")
    .default([]),
});

const listGroupsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 50) : 20)),
  cursor: z.string().optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface GroupChatRow {
  id: string;
  name: string;
  creator_id: string;
  avatar_emoji: string;
  tag: string | null;
  member_count: number;
  max_members: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  user_role: string;
  last_message_at: string;
}

// ---------------------------------------------------------------------------
// POST /api/messages/group
// ---------------------------------------------------------------------------

/**
 * Create a new group chat.
 *
 * The authenticated user becomes the creator and first admin.
 * Initial members (if provided) are added as regular members.
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, createGroupSchema);

    // Deduplicate and filter out the creator from memberIds
    const uniqueMembers = [
      ...new Set(body.memberIds.filter((id) => id !== auth.user.sub)),
    ];

    if (uniqueMembers.length + 1 > MAX_GROUP_MEMBERS) {
      throw badRequest(
        `Group chats support a maximum of ${MAX_GROUP_MEMBERS} members`
      );
    }

    // Verify all provided member IDs are valid users
    if (uniqueMembers.length > 0) {
      const { rows: validUsers } = await db.query<{ id: string }>(
        `SELECT id FROM users
         WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [uniqueMembers]
      );

      if (validUsers.length !== uniqueMembers.length) {
        throw badRequest("One or more member IDs are invalid");
      }
    }

    const group = await db.transaction(async (tx) => {
      // Create group chat record
      const { rows: groupRows } = await tx.query<{
        id: string;
        name: string;
        creator_id: string;
        avatar_emoji: string;
        tag: string | null;
        member_count: number;
        max_members: number;
        is_active: boolean;
        created_at: string;
        updated_at: string;
      }>(
        `INSERT INTO group_chats (name, creator_id, avatar_emoji, tag, member_count, max_members)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, creator_id, avatar_emoji, tag, member_count, max_members,
                   is_active, created_at, updated_at`,
        [
          body.name,
          auth.user.sub,
          body.avatarEmoji,
          body.tag ?? null,
          uniqueMembers.length + 1, // creator + initial members
          MAX_GROUP_MEMBERS,
        ]
      );

      const group = groupRows[0];
      if (!group) throw new Error("Group creation failed");

      // Add creator as admin
      await tx.query(
        `INSERT INTO group_chat_members (group_chat_id, user_id, role)
         VALUES ($1, $2, 'admin')`,
        [group.id, auth.user.sub]
      );

      // Add initial members
      if (uniqueMembers.length > 0) {
        const memberValues = uniqueMembers
          .map((_, idx) => `($1, $${idx + 2}, 'member')`)
          .join(", ");

        await tx.query(
          `INSERT INTO group_chat_members (group_chat_id, user_id, role)
           VALUES ${memberValues}`,
          [group.id, ...uniqueMembers]
        );
      }

      return group;
    });

    return NextResponse.json({ group }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/messages/group
// ---------------------------------------------------------------------------

/**
 * Return the list of group chats the authenticated user belongs to.
 * Sorted by most recent activity descending.
 */
export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { limit, cursor } = validateSearchParams(
      req.nextUrl.searchParams,
      listGroupsQuerySchema
    );

    const cursorClause = cursor ? `AND gc.updated_at < $3` : "";
    const params: (string | number)[] = [auth.user.sub, limit];
    if (cursor) params.push(cursor);

    const { rows } = await db.query<GroupChatRow>(
      `SELECT
         gc.id,
         gc.name,
         gc.creator_id,
         gc.avatar_emoji,
         gc.tag,
         gc.member_count,
         gc.max_members,
         gc.is_active,
         gc.created_at,
         gc.updated_at,
         gcm.role AS user_role,
         gc.updated_at AS last_message_at
       FROM group_chats gc
       JOIN group_chat_members gcm ON gcm.group_chat_id = gc.id AND gcm.user_id = $1
       WHERE gc.is_active = TRUE
         ${cursorClause}
       ORDER BY gc.updated_at DESC
       LIMIT $2`,
      params
    );

    const nextCursor =
      rows.length === limit
        ? rows[rows.length - 1]?.last_message_at ?? null
        : null;

    return NextResponse.json(
      {
        items: rows,
        nextCursor,
        hasMore: nextCursor !== null,
        total: rows.length,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
