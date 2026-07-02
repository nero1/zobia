export const dynamic = 'force-dynamic';

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
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { guildTierXpRequired, guildTierMaxMembers } from "@/lib/guilds/tiers";

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

interface WarWithOpponentRow extends WarRow {
  opponent_name: string;
  opponent_crest_emoji: string;
}

interface QuestRow {
  id: string;
  title: string;
  description: string;
  target_count: number;
  current_count: number;
  reward_guild_xp: number;
  week_end: string;
}

interface AllianceRow {
  alliance_id: string;
  alliance_name: string;
  founded_by: string;
  joined_at: string;
}

/**
 * Fetch full guild detail — public profile shape consumed by
 * app/(app)/guilds/[guildId]/page.tsx and app/(app)/guild/page.tsx (the
 * "my guild" dashboard reuses this same endpoint for the caller's own
 * guild_id — see the fix note in guild/page.tsx).
 *
 * Response is a flat, camelCased GuildDetail object (not the raw snake_case
 * guild row) — the two web pages above, and the Android guild routes that
 * mirror them, all destructure isMember/isCaptain/tierXpRequired/activeWar/
 * warHistory/allianceHistory/activeQuests/recruitmentMode directly.
 */
export const GET = withAuth(
  async (
    req: NextRequest,

    { params, auth }: { params: { guildId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { guildId } = params;
      const userId = auth.user.sub;

      const guildResult = await db.query<GuildDetailRow>(
        `SELECT id, name, crest_emoji, description, city, country, captain_id,
                tier, guild_xp, member_count, treasury_balance, treasury_cap,
                recruitment_type, wars_won, wars_lost, is_active, created_at, updated_at
         FROM guilds WHERE id = $1 AND is_active = TRUE`,
        [guildId]
      );

      if (!guildResult.rows[0]) throw notFound("Guild not found");
      const guild = guildResult.rows[0];

      const membershipResult = await db.query<{ role: string }>(
        `SELECT role FROM guild_members WHERE guild_id = $1 AND user_id = $2 AND left_at IS NULL LIMIT 1`,
        [guildId, userId]
      );
      const isMember = membershipResult.rows.length > 0;
      const isCaptain = guild.captain_id === userId;

      // Fetch members with public profile info. The roster (usernames,
      // contribution scores) is member/captain-only for invite-only guilds —
      // non-members only see the aggregate memberCount for those.
      const isInviteOnly = guild.recruitment_type === "invite_only";
      const canSeeRoster = isMember || isCaptain || !isInviteOnly;
      const membersResult = canSeeRoster
        ? await db.query<MemberRow>(
            `SELECT gm.id, gm.user_id, gm.role, gm.contribution_score,
                    gm.war_points_total, gm.joined_at,
                    u.username, u.display_name, u.avatar_emoji, u.rank_name, u.xp_total
             FROM guild_members gm
             JOIN users u ON u.id = gm.user_id
             WHERE gm.guild_id = $1 AND gm.left_at IS NULL
             ORDER BY gm.contribution_score DESC`,
            [guildId]
          )
        : { rows: [] as MemberRow[] };

      // Fetch recent war history (last 10) with opponent info resolved
      const warsResult = await db.query<WarWithOpponentRow>(
        `SELECT gw.id, gw.challenger_guild_id, gw.defender_guild_id, gw.status,
                gw.challenger_points, gw.defender_points, gw.winner_guild_id,
                gw.starts_at, gw.ends_at, gw.final_hour_starts_at, gw.created_at,
                og.name AS opponent_name, og.crest_emoji AS opponent_crest_emoji
         FROM guild_wars gw
         JOIN guilds og ON og.id = (
           CASE WHEN gw.challenger_guild_id = $1 THEN gw.defender_guild_id ELSE gw.challenger_guild_id END
         )
         WHERE gw.challenger_guild_id = $1 OR gw.defender_guild_id = $1
         ORDER BY gw.created_at DESC
         LIMIT 10`,
        [guildId]
      );

      const activeWarRow = warsResult.rows.find((w) => w.status === "active" || w.status === "final_hour");
      const myScore = (w: WarWithOpponentRow) => (w.challenger_guild_id === guildId ? w.challenger_points : w.defender_points);
      const opponentScore = (w: WarWithOpponentRow) => (w.challenger_guild_id === guildId ? w.defender_points : w.challenger_points);

      const activeWar = activeWarRow
        ? {
            id: activeWarRow.id,
            opponentName: activeWarRow.opponent_name,
            opponentCrestEmoji: activeWarRow.opponent_crest_emoji,
            myScore: myScore(activeWarRow),
            opponentScore: opponentScore(activeWarRow),
            endsAt: activeWarRow.ends_at,
            finalHour: activeWarRow.status === "final_hour",
          }
        : null;

      const warHistory = warsResult.rows
        .filter((w) => w.status === "completed" || w.status === "resolved")
        .map((w) => ({
          id: w.id,
          opponentName: w.opponent_name,
          opponentCrestEmoji: w.opponent_crest_emoji,
          result: !w.winner_guild_id ? "draw" : w.winner_guild_id === guildId ? "win" : "loss",
          myScore: myScore(w),
          opponentScore: opponentScore(w),
          endedAt: w.ends_at,
        }));

      // Current alliance (if any) — guild_alliance_members has no departure
      // tracking (no left_at column), so "history" here is just the active
      // alliance, not a full past-alliances list.
      const allianceResult = await db.query<AllianceRow>(
        `SELECT ga.id AS alliance_id, ga.name AS alliance_name, ga.founded_by, gam.joined_at
         FROM guild_alliance_members gam
         JOIN guild_alliances ga ON ga.id = gam.alliance_id
         WHERE gam.guild_id = $1 AND ga.is_active = TRUE
         LIMIT 1`,
        [guildId]
      );
      const allianceHistory = allianceResult.rows.map((a) => ({
        id: a.alliance_id,
        allianceName: a.alliance_name,
        role: a.founded_by === guildId ? "initiator" : "ally",
        joinedAt: a.joined_at,
        leftAt: null as string | null,
      }));

      // Active guild quests (current week), members-only detail
      const activeQuests = isMember
        ? (
            await db.query<QuestRow>(
              `SELECT id, title, description, target_count, current_count, reward_guild_xp, week_end
               FROM guild_quests
               WHERE guild_id = $1 AND week_start <= NOW() AND week_end >= NOW()
               ORDER BY created_at ASC`,
              [guildId]
            )
          ).rows.map((q) => ({
            id: q.id,
            title: q.title,
            description: q.description,
            progressPct: q.target_count > 0 ? Math.min(100, (q.current_count / q.target_count) * 100) : 0,
            rewardXp: q.reward_guild_xp,
            endsAt: q.week_end,
          }))
        : [];

      const detail = {
        id: guild.id,
        name: guild.name,
        crestEmoji: guild.crest_emoji,
        description: guild.description,
        city: guild.city,
        tier: guild.tier,
        guildXp: Number(guild.guild_xp),
        tierXpRequired: guildTierXpRequired(guild.tier, Number(guild.guild_xp)),
        memberCount: guild.member_count,
        maxMembers: guildTierMaxMembers(guild.tier),
        warWins: guild.wars_won,
        warLosses: guild.wars_lost,
        treasuryBalance: isMember ? Number(guild.treasury_balance) : null,
        isOpenToJoin: guild.recruitment_type !== "invite_only",
        isMember,
        isCaptain,
        activeWar,
        members: membersResult.rows.map((m) => ({
          userId: m.user_id,
          username: m.username,
          displayName: m.display_name,
          avatarEmoji: m.avatar_emoji,
          role: m.role,
          contributionScore: m.contribution_score,
          joinedAt: m.joined_at,
        })),
        warHistory,
        allianceHistory,
        activeQuests,
        recruitmentMode: guild.recruitment_type,
        createdAt: guild.created_at,
      };

      return NextResponse.json({ success: true, data: detail, guild: detail, error: null });
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
    
    { params, auth }: { params: { guildId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { guildId } = params;
      const userId = auth.user.sub;
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
