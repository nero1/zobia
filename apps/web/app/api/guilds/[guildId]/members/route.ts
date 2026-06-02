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
import { db } from "@/lib/db";
import { withAuth, validateBody, type AuthContext } from "@/lib/api/middleware";
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
// Row types
// ---------------------------------------------------------------------------

interface MemberRow {
  id: string;
  user_id: string;
  role: string;
  contribution_score: number;
  war_points_total: number;
  joined_at: string;
  username: string;
  display_name: string;
  avatar_emoji: string;
  rank_name: string;
  xp_total: number;
}

// ---------------------------------------------------------------------------
// GET /api/guilds/[guildId]/members
// ---------------------------------------------------------------------------

/**
 * Fetch all guild members with contribution scores, sorted by contribution desc.
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    ctx: AuthContext,
    { params }: { params: { guildId: string } }
  ) => {
    try {
      const { guildId } = params;

      const guildExists = await db.query<{ id: string }>(
        `SELECT id FROM guilds WHERE id = $1 AND is_active = TRUE`,
        [guildId]
      );
      if (!guildExists.rows[0]) throw notFound("Guild not found");

      const result = await db.query<MemberRow>(
        `SELECT gm.id, gm.user_id, gm.role, gm.contribution_score,
                gm.war_points_total, gm.joined_at,
                u.username, u.display_name, u.avatar_emoji, u.rank_name, u.xp_total
         FROM guild_members gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.guild_id = $1
         ORDER BY gm.contribution_score DESC`,
        [guildId]
      );

      return NextResponse.json({
        success: true,
        data: { members: result.rows, total: result.rowCount },
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
    ctx: AuthContext,
    { params }: { params: { guildId: string } }
  ) => {
    try {
      const { guildId } = params;
      const captainId = ctx.user.sub;
      const body = await validateBody(req, updateRoleSchema);

      // Verify caller is captain
      const captainCheck = await db.query<{ captain_id: string }>(
        `SELECT captain_id FROM guilds WHERE id = $1 AND is_active = TRUE`,
        [guildId]
      );
      if (!captainCheck.rows[0]) throw notFound("Guild not found");
      if (captainCheck.rows[0].captain_id !== captainId) {
        throw forbidden("Only the guild captain can update member roles");
      }
      if (body.userId === captainId) {
        throw badRequest("Cannot change your own role as captain");
      }

      const updateResult = await db.query(
        `UPDATE guild_members SET role = $1
         WHERE guild_id = $2 AND user_id = $3`,
        [body.role, guildId, body.userId]
      );

      if (updateResult.rowCount === 0) throw notFound("Member not found in this guild");

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
 * Remove a member from the guild. Captain only.
 * Body: { userId }
 */
export const DELETE = withAuth(
  async (
    req: NextRequest,
    ctx: AuthContext,
    { params }: { params: { guildId: string } }
  ) => {
    try {
      const { guildId } = params;
      const captainId = ctx.user.sub;
      const body = await validateBody(req, removeMemberSchema);

      const captainCheck = await db.query<{ captain_id: string }>(
        `SELECT captain_id FROM guilds WHERE id = $1 AND is_active = TRUE`,
        [guildId]
      );
      if (!captainCheck.rows[0]) throw notFound("Guild not found");
      if (captainCheck.rows[0].captain_id !== captainId) {
        throw forbidden("Only the guild captain can remove members");
      }
      if (body.userId === captainId) {
        throw badRequest("Captain cannot remove themselves; transfer ownership first");
      }

      await db.transaction(async (client) => {
        const removeResult = await client.query(
          `DELETE FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
          [guildId, body.userId]
        );
        if (removeResult.rowCount === 0) throw notFound("Member not found in this guild");

        // Decrement member count
        await client.query(
          `UPDATE guilds SET member_count = GREATEST(member_count - 1, 0), updated_at = NOW()
           WHERE id = $1`,
          [guildId]
        );

        // Clear user's guild_id
        await client.query(
          `UPDATE users SET guild_id = NULL, updated_at = NOW() WHERE id = $1`,
          [body.userId]
        );
      });

      return NextResponse.json({ success: true, data: { removed: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
