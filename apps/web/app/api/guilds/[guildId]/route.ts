/**
 * app/api/guilds/[guildId]/route.ts
 *
 * Guild detail and update.
 *
 * GET /api/guilds/[guildId]
 *   - Returns full guild detail: info, member list, war record, stats
 *
 * PUT /api/guilds/[guildId]
 *   - Update guild info (captain only)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody, type AuthContext } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const updateGuildSchema = z.object({
  name: z.string().min(3).max(40).optional(),
  crestEmoji: z.string().min(1).max(4).optional(),
  description: z.string().max(300).optional(),
  recruitmentType: z.enum(["open", "approval", "invite_only"]).optional(),
});

// ---------------------------------------------------------------------------
// GET /api/guilds/[guildId]
// ---------------------------------------------------------------------------

interface GuildDetailRow {
  id: string;
  name: string;
  crest_emoji: string;
  description: string | null;
  city: string | null;
  country: string;
  captain_id: string;
  tier: string;
  guild_xp: number;
  member_count: number;
  treasury_balance: number;
  treasury_cap: number;
  recruitment_type: string;
  wars_won: number;
  wars_lost: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

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

interface WarRow {
  id: string;
  challenger_guild_id: string;
  defender_guild_id: string;
  status: string;
  challenger_points: number;
  defender_points: number;
  winner_guild_id: string | null;
  starts_at: string;
  ends_at: string;
  final_hour_starts_at: string;
  created_at: string;
}

/**
 * Fetch full guild detail including members and recent wars.
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    ctx: AuthContext,
    { params }: { params: { guildId: string } }
  ) => {
    try {
      const { guildId } = params;

      const guildResult = await db.query<GuildDetailRow>(
        `SELECT id, name, crest_emoji, description, city, country, captain_id,
                tier, guild_xp, member_count, treasury_balance, treasury_cap,
                recruitment_type, wars_won, wars_lost, is_active, created_at, updated_at
         FROM guilds WHERE id = $1 AND is_active = TRUE`,
        [guildId]
      );

      if (!guildResult.rows[0]) throw notFound("Guild not found");
      const guild = guildResult.rows[0];

      // Fetch members with public profile info
      const membersResult = await db.query<MemberRow>(
        `SELECT gm.id, gm.user_id, gm.role, gm.contribution_score,
                gm.war_points_total, gm.joined_at,
                u.username, u.display_name, u.avatar_emoji, u.rank_name, u.xp_total
         FROM guild_members gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.guild_id = $1
         ORDER BY gm.contribution_score DESC`,
        [guildId]
      );

      // Fetch recent war history (last 10)
      const warsResult = await db.query<WarRow>(
        `SELECT id, challenger_guild_id, defender_guild_id, status,
                challenger_points, defender_points, winner_guild_id,
                starts_at, ends_at, final_hour_starts_at, created_at
         FROM guild_wars
         WHERE challenger_guild_id = $1 OR defender_guild_id = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [guildId]
      );

      return NextResponse.json({
        success: true,
        data: {
          guild,
          members: membersResult.rows,
          recentWars: warsResult.rows,
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/guilds/[guildId]
// ---------------------------------------------------------------------------

/**
 * Update guild info. Captain only.
 */
export const PUT = withAuth(
  async (
    req: NextRequest,
    ctx: AuthContext,
    { params }: { params: { guildId: string } }
  ) => {
    try {
      const { guildId } = params;
      const userId = ctx.user.sub;
      const body = await validateBody(req, updateGuildSchema);

      // Verify user is captain
      const captainCheck = await db.query<{ captain_id: string }>(
        `SELECT captain_id FROM guilds WHERE id = $1 AND is_active = TRUE`,
        [guildId]
      );
      if (!captainCheck.rows[0]) throw notFound("Guild not found");
      if (captainCheck.rows[0].captain_id !== userId) {
        throw forbidden("Only the guild captain can update guild info");
      }

      // Build dynamic update
      const updates: string[] = ["updated_at = NOW()"];
      const values: (string | null)[] = [];
      let idx = 1;

      if (body.name !== undefined) {
        updates.push(`name = $${idx++}`);
        values.push(body.name);
      }
      if (body.crestEmoji !== undefined) {
        updates.push(`crest_emoji = $${idx++}`);
        values.push(body.crestEmoji);
      }
      if (body.description !== undefined) {
        updates.push(`description = $${idx++}`);
        values.push(body.description);
      }
      if (body.recruitmentType !== undefined) {
        updates.push(`recruitment_type = $${idx++}`);
        values.push(body.recruitmentType);
      }

      if (updates.length === 1) throw badRequest("No fields to update");

      values.push(guildId);
      await db.query(
        `UPDATE guilds SET ${updates.join(", ")} WHERE id = $${idx}`,
        values
      );

      return NextResponse.json({ success: true, data: { updated: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
