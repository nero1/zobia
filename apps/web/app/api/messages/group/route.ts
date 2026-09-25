export const dynamic = 'force-dynamic';

/**
 * app/api/messages/group/route.ts
 *
 * Group chat management endpoints.
 *
 * POST /api/messages/group — Create a new group chat
 *   - Creator becomes the first admin member
 *   - Enforces max total-membership size (plan-based, PRD §3/§5)
 *   - Enforces how many *concurrently active* groups the creator's plan/
 *     business tier/guild-ownership allows them to create (admin
 *     configurable via manifest.groupChatCreationLimits)
 *
 * GET /api/messages/group — List group chats the current user belongs to
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { resolveGroupCreationEligibility } from "@/lib/groupChats/eligibility";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Plan-based group chat TOTAL MEMBERSHIP limits (PRD §3/§5) — distinct from
 *  the concurrent-presence cap (manifest.groupChatCaps) and the
 *  how-many-groups-can-I-create limit (manifest.groupChatCreationLimits). */
const PLAN_GROUP_LIMITS: Record<string, number> = {
  free:  300,
  plus:  400,
  pro:   500,
  max:   1000,
};

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
  tag: z.enum(["Personal", "General", "Study Group", "Crew", "Business", "Other"]).optional(),
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
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, createGroupSchema);

    // Fetch the creator's plan for group size enforcement
    const orm = await getDb();
    const [planRow] = await orm
      .select({ plan: schema.users.plan, is_admin: schema.users.isAdmin })
      .from(schema.users)
      .where(eq(schema.users.id, auth.user.sub))
      .limit(1);
    const userPlan = planRow?.plan ?? "free";
    const isAdmin = planRow?.is_admin ?? false;
    const maxGroupMembers = PLAN_GROUP_LIMITS[userPlan] ?? PLAN_GROUP_LIMITS.free;

    // Who-can-create-groups gating (admin configurable via manifest.groupChatCreationLimits)
    if (!isAdmin) {
      const eligibility = await resolveGroupCreationEligibility(auth.user.sub);
      if (eligibility.limit <= 0) {
        throw forbidden(
          "Your plan does not allow creating group chats. Upgrade to Pro, Max, a Business account, or found a Guild.",
          "GROUP_CREATION_NOT_ALLOWED"
        );
      }
      if (!eligibility.allowed) {
        throw forbidden(
          `You've reached your limit of ${eligibility.limit} active group chat(s) for your plan.`,
          "GROUP_CREATION_LIMIT_REACHED"
        );
      }
    }

    // Deduplicate and filter out the creator from memberIds
    const uniqueMembers = [
      ...new Set(body.memberIds.filter((id) => id !== auth.user.sub)),
    ];

    if (uniqueMembers.length + 1 > maxGroupMembers) {
      throw badRequest(
        `Your ${userPlan} plan supports groups of up to ${maxGroupMembers} members. Upgrade to add more.`
      );
    }

    // Verify all provided member IDs are valid users
    if (uniqueMembers.length > 0) {
      const validUsers = await orm
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(inArray(schema.users.id, uniqueMembers), isNull(schema.users.deletedAt)));

      if (validUsers.length !== uniqueMembers.length) {
        throw badRequest("One or more member IDs are invalid");
      }
    }

    // Business creator info (for ad suppression + join/message credit config eligibility)
    const [bizRow] = await orm
      .select({ tier: schema.businessAccounts.tier })
      .from(schema.businessAccounts)
      .where(and(eq(schema.businessAccounts.userId, auth.user.sub), eq(schema.businessAccounts.status, "active")))
      .limit(1);
    const businessTier = bizRow?.tier ?? null;

    const group = await orm.transaction(async (tx) => {
      // Create group chat record.
      // group_chats.creator_plan_at_creation / creator_business_tier_at_creation
      // / is_business exist in the DB (migration 0001) but are not present in
      // lib/db/schema.ts, so this insert stays raw SQL.
      const { rows: groupRows } = await tx.execute<{
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
      }>(sql`
        INSERT INTO group_chats
           (name, creator_id, avatar_emoji, tag, member_count, max_members,
            creator_plan_at_creation, creator_business_tier_at_creation, is_business)
         VALUES (${body.name}, ${auth.user.sub}, ${body.avatarEmoji}, ${body.tag ?? null},
                 ${uniqueMembers.length + 1}, ${maxGroupMembers}, ${userPlan}, ${businessTier},
                 ${businessTier !== null})
         RETURNING id, name, creator_id, avatar_emoji, tag, member_count, max_members,
                   is_active, created_at, updated_at
      `);

      const group = groupRows[0];
      if (!group) throw new Error("Group creation failed");

      // Add creator as admin.
      // group_chat_members.can_invite exists in the DB but is not present in
      // lib/db/schema.ts, so this insert stays raw SQL.
      await tx.execute(sql`
        INSERT INTO group_chat_members (group_chat_id, user_id, role, can_invite)
         VALUES (${group.id}, ${auth.user.sub}, 'admin', TRUE)
      `);

      // Add initial members
      if (uniqueMembers.length > 0) {
        await tx.insert(schema.groupChatMembers).values(
          uniqueMembers.map((userId) => ({
            groupChatId: group.id,
            userId,
            role: "member",
          }))
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
 * Sorted by most recent activity descending. Deactivated groups (grace
 * period lapsed) are excluded — see lib/plans/groupChatSweep.ts.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { limit, cursor } = validateSearchParams(
      req.nextUrl.searchParams,
      listGroupsQuerySchema
    );

    const cursorClause = cursor ? sql`AND gc.updated_at < ${cursor}` : sql``;

    // group_chats.is_deactivated exists in the DB (migration 0001) but is not
    // present in lib/db/schema.ts, so this stays raw SQL.
    const orm = await getDb();
    const { rows } = await orm.execute<GroupChatRow & Record<string, unknown>>(sql`
      SELECT
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
       JOIN group_chat_members gcm ON gcm.group_chat_id = gc.id AND gcm.user_id = ${auth.user.sub}
       WHERE gc.is_active = TRUE
         AND gc.is_deactivated = FALSE
         AND NOT EXISTS (
           SELECT 1 FROM group_chat_blocks b
           WHERE b.group_chat_id = gc.id AND b.user_id = ${auth.user.sub}
         )
         ${cursorClause}
       ORDER BY gc.updated_at DESC
       LIMIT ${limit}
    `);

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
