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
import { and, desc, eq, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db/drizzle";
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
      const orm = await getDb();

      const [guild] = await orm
        .select({
          id: schema.guilds.id,
          name: schema.guilds.name,
          crest_emoji: schema.guilds.crestEmoji,
          description: schema.guilds.description,
          city: schema.guilds.city,
          country: schema.guilds.country,
          captain_id: schema.guilds.captainId,
          tier: schema.guilds.tier,
          guild_xp: schema.guilds.guildXp,
          member_count: schema.guilds.memberCount,
          treasury_balance: schema.guilds.treasuryBalance,
          treasury_cap: schema.guilds.treasuryCap,
          recruitment_type: schema.guilds.recruitmentType,
          wars_won: schema.guilds.warsWon,
          wars_lost: schema.guilds.warsLost,
          is_active: schema.guilds.isActive,
          created_at: schema.guilds.createdAt,
          updated_at: schema.guilds.updatedAt,
        })
        .from(schema.guilds)
        .where(and(eq(schema.guilds.id, guildId), eq(schema.guilds.isActive, true)))
        .limit(1);

      if (!guild) throw notFound("Guild not found");

      const [membership] = await orm
        .select({ role: schema.guildMembers.role, is_moderator: schema.guildMembers.isModerator })
        .from(schema.guildMembers)
        .where(and(eq(schema.guildMembers.guildId, guildId), eq(schema.guildMembers.userId, userId), sql`${schema.guildMembers.leftAt} IS NULL`))
        .limit(1);
      const isMember = Boolean(membership);
      const isCaptain = guild.captain_id === userId;
      const isModerator = isCaptain || Boolean(membership?.is_moderator);

      // Fetch members with public profile info. The roster (usernames,
      // contribution scores) is member/captain-only for invite-only guilds —
      // non-members only see the aggregate memberCount for those.
      const isInviteOnly = guild.recruitment_type === "invite_only";
      const canSeeRoster = isMember || isCaptain || !isInviteOnly;
      const membersRows = canSeeRoster
        ? await orm
            .select({
              id: schema.guildMembers.id,
              user_id: schema.guildMembers.userId,
              role: schema.guildMembers.role,
              contribution_score: schema.guildMembers.contributionScore,
              war_points_total: schema.guildMembers.warPointsTotal,
              joined_at: schema.guildMembers.joinedAt,
              is_moderator: schema.guildMembers.isModerator,
              username: schema.users.username,
              display_name: schema.users.displayName,
              avatar_emoji: schema.users.avatarEmoji,
              rank_name: schema.users.rankName,
              xp_total: schema.users.xpTotal,
            })
            .from(schema.guildMembers)
            .innerJoin(schema.users, eq(schema.users.id, schema.guildMembers.userId))
            .where(and(eq(schema.guildMembers.guildId, guildId), sql`${schema.guildMembers.leftAt} IS NULL`))
            .orderBy(desc(schema.guildMembers.contributionScore))
        : [];

      // Fetch recent war history (last 10) with opponent info resolved
      const opponentGuild = alias(schema.guilds, "og");
      const warsRows = await orm
        .select({
          id: schema.guildWars.id,
          challenger_guild_id: schema.guildWars.challengerGuildId,
          defender_guild_id: schema.guildWars.defenderGuildId,
          status: schema.guildWars.status,
          challenger_points: schema.guildWars.challengerPoints,
          defender_points: schema.guildWars.defenderPoints,
          winner_guild_id: schema.guildWars.winnerGuildId,
          starts_at: schema.guildWars.startsAt,
          ends_at: schema.guildWars.endsAt,
          final_hour_starts_at: schema.guildWars.finalHourStartsAt,
          created_at: schema.guildWars.createdAt,
          opponent_name: opponentGuild.name,
          opponent_crest_emoji: opponentGuild.crestEmoji,
        })
        .from(schema.guildWars)
        .innerJoin(
          opponentGuild,
          eq(
            opponentGuild.id,
            sql`CASE WHEN ${schema.guildWars.challengerGuildId} = ${guildId} THEN ${schema.guildWars.defenderGuildId} ELSE ${schema.guildWars.challengerGuildId} END`
          )
        )
        .where(or(eq(schema.guildWars.challengerGuildId, guildId), eq(schema.guildWars.defenderGuildId, guildId)))
        .orderBy(desc(schema.guildWars.createdAt))
        .limit(10);

      type WarWithOpponentRow = (typeof warsRows)[number];
      const activeWarRow = warsRows.find((w) => w.status === "active" || w.status === "final_hour");
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

      const warHistory = warsRows
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
      const allianceRows = await orm
        .select({
          alliance_id: schema.guildAlliances.id,
          alliance_name: schema.guildAlliances.name,
          founded_by: schema.guildAlliances.foundedBy,
          joined_at: schema.guildAllianceMembers.joinedAt,
        })
        .from(schema.guildAllianceMembers)
        .innerJoin(schema.guildAlliances, eq(schema.guildAlliances.id, schema.guildAllianceMembers.allianceId))
        .where(and(eq(schema.guildAllianceMembers.guildId, guildId), eq(schema.guildAlliances.isActive, true)))
        .limit(1);
      const allianceHistory = allianceRows.map((a) => ({
        id: a.alliance_id,
        allianceName: a.alliance_name,
        role: a.founded_by === guildId ? "initiator" : "ally",
        joinedAt: a.joined_at,
        leftAt: null as string | null,
      }));

      // Active guild quests (current week), members-only detail
      const activeQuests = isMember
        ? (
            await orm
              .select({
                id: schema.guildQuests.id,
                title: schema.guildQuests.title,
                description: schema.guildQuests.description,
                target_count: schema.guildQuests.targetCount,
                current_count: schema.guildQuests.currentCount,
                reward_guild_xp: schema.guildQuests.rewardGuildXp,
                week_end: schema.guildQuests.weekEnd,
              })
              .from(schema.guildQuests)
              .where(and(eq(schema.guildQuests.guildId, guildId), sql`${schema.guildQuests.weekStart} <= NOW()`, sql`${schema.guildQuests.weekEnd} >= NOW()`))
              .orderBy(sql`${schema.guildQuests.createdAt} ASC`)
          ).map((q) => ({
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
        isModerator,
        activeWar,
        members: membersRows.map((m) => ({
          userId: m.user_id,
          username: m.username,
          displayName: m.display_name,
          avatarEmoji: m.avatar_emoji,
          role: m.role,
          contributionScore: m.contribution_score,
          joinedAt: m.joined_at,
          isModerator: m.is_moderator,
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
      const orm = await getDb();

      // Verify user is captain
      const [captainCheck] = await orm
        .select({ captain_id: schema.guilds.captainId })
        .from(schema.guilds)
        .where(and(eq(schema.guilds.id, guildId), eq(schema.guilds.isActive, true)))
        .limit(1);
      if (!captainCheck) throw notFound("Guild not found");
      if (captainCheck.captain_id !== userId) {
        throw forbidden("Only the guild captain can update guild info");
      }

      // Build dynamic update
      const updates: Partial<typeof schema.guilds.$inferInsert> = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.crestEmoji !== undefined) updates.crestEmoji = body.crestEmoji;
      if (body.description !== undefined) updates.description = body.description;
      if (body.recruitmentType !== undefined) updates.recruitmentType = body.recruitmentType;

      if (Object.keys(updates).length === 0) throw badRequest("No fields to update");

      updates.updatedAt = new Date();
      await orm.update(schema.guilds).set(updates).where(eq(schema.guilds.id, guildId));

      return NextResponse.json({ success: true, data: { updated: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
