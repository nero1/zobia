export const dynamic = 'force-dynamic';

/**
 * app/api/guilds/[guildId]/members/route.ts
 *
 * Guild member management.
 *
 * GET  /api/guilds/[guildId]/members
 *   - Member list with contribution scores
 *
 * PUT  /api/guilds/[guildId]/members/[userId]
 *   - Update member role (captain only)
 *
 * DELETE /api/guilds/[guildId]/members/[userId]
 *   - Remove member (captain only)
 *
 * Note: PUT and DELETE with [userId] segment are handled in the
 *       /members/[userId]/route.ts convention. This file handles GET.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const updateRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["veteran", "recruiter", "member"]),
});

const removeMemberSchema = z.object({
  userId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// GET /api/guilds/[guildId]/members
// ---------------------------------------------------------------------------

/**
 * Fetch all guild members with contribution scores, sorted by contribution desc.
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    
    { params, auth }: { params: { guildId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { guildId } = params;
      const orm = await getDb();

      const [guildRow] = await orm
        .select({ id: schema.guilds.id })
        .from(schema.guilds)
        .where(and(eq(schema.guilds.id, guildId), eq(schema.guilds.isActive, true)))
        .limit(1);
      if (!guildRow) throw notFound("Guild not found");

      const members = await orm
        .select({
          id: schema.guildMembers.id,
          user_id: schema.guildMembers.userId,
          role: schema.guildMembers.role,
          contribution_score: schema.guildMembers.contributionScore,
          war_points_total: schema.guildMembers.warPointsTotal,
          joined_at: schema.guildMembers.joinedAt,
          username: schema.users.username,
          display_name: schema.users.displayName,
          avatar_emoji: schema.users.avatarEmoji,
          rank_name: schema.users.rankName,
          xp_total: schema.users.xpTotal,
        })
        .from(schema.guildMembers)
        .innerJoin(schema.users, eq(schema.users.id, schema.guildMembers.userId))
        .where(eq(schema.guildMembers.guildId, guildId))
        .orderBy(desc(schema.guildMembers.contributionScore));

      return NextResponse.json({
        success: true,
        data: { members, total: members.length },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/guilds/[guildId]/members — update role (captain only)
// ---------------------------------------------------------------------------

/**
 * Update a member's role. Captain only.
 * Body: { userId, role }
 */
export const PUT = withAuth(
  async (
    req: NextRequest,
    
    { params, auth }: { params: { guildId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { guildId } = params;
      const captainId = auth.user.sub;
      const body = await validateBody(req, updateRoleSchema);
      const orm = await getDb();

      // Verify caller is captain
      const [captainCheck] = await orm
        .select({ captain_id: schema.guilds.captainId })
        .from(schema.guilds)
        .where(and(eq(schema.guilds.id, guildId), eq(schema.guilds.isActive, true)))
        .limit(1);
      if (!captainCheck) throw notFound("Guild not found");
      if (captainCheck.captain_id !== captainId) {
        throw forbidden("Only the guild captain can update member roles");
      }
      if (body.userId === captainId) {
        throw badRequest("Cannot change your own role as captain");
      }

      const updated = await orm
        .update(schema.guildMembers)
        .set({ role: body.role })
        .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, body.userId)))
        .returning({ id: schema.guildMembers.id });

      if (updated.length === 0) throw notFound("Member not found in this guild");

      return NextResponse.json({ success: true, data: { updated: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/guilds/[guildId]/members — remove member (captain only)
// ---------------------------------------------------------------------------

/**
 * Remove a member from the guild. Either the guild captain removing someone
 * else (kick), or a member removing themselves (leave). The captain cannot
 * remove themselves — they must transfer ownership first.
 * Body: { userId }
 */
export const DELETE = withAuth(
  async (
    req: NextRequest,

    { params, auth }: { params: { guildId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { guildId } = params;
      const callerId = auth.user.sub;
      const body = await validateBody(req, removeMemberSchema);
      const orm = await getDb();

      const [captainCheck] = await orm
        .select({ captain_id: schema.guilds.captainId })
        .from(schema.guilds)
        .where(and(eq(schema.guilds.id, guildId), eq(schema.guilds.isActive, true)))
        .limit(1);
      if (!captainCheck) throw notFound("Guild not found");
      const isCaptain = captainCheck.captain_id === callerId;

      if (isCaptain) {
        if (body.userId === callerId) {
          throw badRequest("Captain cannot remove themselves; transfer ownership first");
        }
      } else if (body.userId !== callerId) {
        throw forbidden("Only the guild captain can remove other members");
      }

      await orm.transaction(async (tx) => {
        const removed = await tx
          .delete(schema.guildMembers)
          .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, body.userId)))
          .returning({ id: schema.guildMembers.id });
        if (removed.length === 0) throw notFound("Member not found in this guild");

        // Decrement member count
        await tx
          .update(schema.guilds)
          .set({ memberCount: sql`GREATEST(${schema.guilds.memberCount} - 1, 0)`, updatedAt: new Date() })
          .where(eq(schema.guilds.id, guildId));

        // Clear user's guild_id
        await tx
          .update(schema.users)
          .set({ guildId: null, updatedAt: new Date() })
          .where(eq(schema.users.id, body.userId));
      });

      return NextResponse.json({ success: true, data: { removed: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
