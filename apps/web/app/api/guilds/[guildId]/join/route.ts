/**
 * app/api/guilds/[guildId]/join/route.ts
 *
 * POST /api/guilds/[guildId]/join
 *   - open:        Joins immediately
 *   - approval:    Creates a pending application
 *   - invite_only: Requires a valid invite token in the request body
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const joinGuildSchema = z.object({
  /** Required when recruitment_type is 'invite_only'. */
  inviteToken: z.string().optional(),
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

interface GuildRow {
  id: string;
  recruitment_type: string;
  member_count: number;
  is_active: boolean;
}

interface InviteRow {
  id: string;
  guild_id: string;
  invited_user_id: string | null;
  expires_at: string;
  used_at: string | null;
}

/**
 * Join a guild. Behaviour depends on the guild's recruitment_type:
 *   - open:        Immediate membership
 *   - approval:    Pending application created
 *   - invite_only: Requires a valid invite token
 */
export const POST = withAuth(
  async (
    req: NextRequest,
    
    { params, auth }: { params: { guildId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { guildId } = params;
      const userId = auth.user.sub;
      const body = await validateBody(req, joinGuildSchema);

      const result = await db.transaction(async (client) => {
        // 1. Verify guild exists and is active
        const guildResult = await client.query<GuildRow>(
          `SELECT id, recruitment_type, member_count, is_active
           FROM guilds WHERE id = $1 FOR UPDATE`,
          [guildId]
        );
        if (!guildResult.rows[0] || !guildResult.rows[0].is_active) {
          throw notFound("Guild not found");
        }
        const guild = guildResult.rows[0];

        // 2. Check user isn't already a member
        const existingMember = await client.query<{ id: string }>(
          `SELECT id FROM guild_members WHERE user_id = $1 LIMIT 1`,
          [userId]
        );
        if (existingMember.rows.length > 0) {
          throw badRequest("You already belong to a guild", "ALREADY_IN_GUILD");
        }

        // 3. Handle recruitment type
        if (guild.recruitment_type === "open") {
          // Immediate membership
          await client.query(
            `INSERT INTO guild_members (guild_id, user_id, role, contribution_score, war_points_total, joined_at)
             VALUES ($1, $2, 'member', 0, 0, NOW())`,
            [guildId, userId]
          );
          await client.query(
            `UPDATE guilds SET member_count = member_count + 1, updated_at = NOW() WHERE id = $1`,
            [guildId]
          );
          await client.query(
            `UPDATE users SET guild_id = $1, updated_at = NOW() WHERE id = $2`,
            [guildId, userId]
          );
          return { status: "joined" };
        }

        if (guild.recruitment_type === "approval") {
          // Create pending application
          await client.query(
            `INSERT INTO guild_applications (guild_id, user_id, status, created_at)
             VALUES ($1, $2, 'pending', NOW())
             ON CONFLICT (guild_id, user_id) DO NOTHING`,
            [guildId, userId]
          );
          return { status: "pending" };
        }

        if (guild.recruitment_type === "invite_only") {
          if (!body.inviteToken) {
            throw forbidden("An invite token is required to join this guild");
          }
          // Validate invite token
          const inviteResult = await client.query<InviteRow>(
            `SELECT id, guild_id, invited_user_id, expires_at, used_at
             FROM guild_invites
             WHERE token = $1 AND guild_id = $2 FOR UPDATE`,
            [body.inviteToken, guildId]
          );
          const invite = inviteResult.rows[0];
          if (!invite) throw forbidden("Invalid or expired invite token");
          if (invite.used_at) throw forbidden("This invite has already been used");
          if (new Date(invite.expires_at) < new Date()) {
            throw forbidden("This invite has expired");
          }
          if (invite.invited_user_id && invite.invited_user_id !== userId) {
            throw forbidden("This invite is not for your account");
          }

          // Mark invite as used
          await client.query(
            `UPDATE guild_invites SET used_at = NOW(), used_by_user_id = $1 WHERE id = $2`,
            [userId, invite.id]
          );

          // Join guild
          await client.query(
            `INSERT INTO guild_members (guild_id, user_id, role, contribution_score, war_points_total, joined_at)
             VALUES ($1, $2, 'member', 0, 0, NOW())`,
            [guildId, userId]
          );
          await client.query(
            `UPDATE guilds SET member_count = member_count + 1, updated_at = NOW() WHERE id = $1`,
            [guildId]
          );
          await client.query(
            `UPDATE users SET guild_id = $1, updated_at = NOW() WHERE id = $2`,
            [guildId, userId]
          );
          return { status: "joined" };
        }

        throw badRequest("Unknown guild recruitment type");
      });

      return NextResponse.json({ success: true, data: result, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
