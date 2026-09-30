export const dynamic = 'force-dynamic';

/**
 * app/api/guilds/wars/[warId]/leaderboard/route.ts
 *
 * GET /api/guilds/wars/[warId]/leaderboard
 *
 * Returns individual member contribution scores for both guilds in this war,
 * sorted by war_points descending within each guild.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import {
  getAnonymityConfig,
  hiddenOnLeaderboardSql,
  maskLeaderboardRow,
  ANONYMOUS_SNAKE_IDENTITY,
} from "@/lib/privacy/leaderboardAnonymity";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface ContributionRow {
  user_id: string;
  guild_id: string;
  war_points: number;
  username: string;
  display_name: string;
  avatar_emoji: string;
  rank_name: string;
}

interface WarGuildsRow {
  challenger_guild_id: string;
  defender_guild_id: string;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

/**
 * Returns the per-member war point contributions for both guilds.
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { warId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { warId } = params;

      const orm = await getDb();
      const anonymityCfg = await getAnonymityConfig();
      const warRows = await orm
        .select({
          challenger_guild_id: schema.guildWars.challengerGuildId,
          defender_guild_id: schema.guildWars.defenderGuildId,
        })
        .from(schema.guildWars)
        .where(eq(schema.guildWars.id, warId))
        .limit(1);
      if (!warRows[0]) throw notFound("War not found");

      const { challenger_guild_id, defender_guild_id } = warRows[0];

      const rows = await orm
        .select({
          user_id: schema.warContributions.userId,
          guild_id: schema.warContributions.guildId,
          war_points: schema.warContributions.warPoints,
          username: schema.users.username,
          display_name: schema.users.displayName,
          avatar_emoji: schema.users.avatarEmoji,
          rank_name: schema.users.rankName,
          is_anonymous: sql<boolean>`${hiddenOnLeaderboardSql(anonymityCfg, "users")}`,
        })
        .from(schema.warContributions)
        .innerJoin(schema.users, eq(schema.users.id, schema.warContributions.userId))
        .where(eq(schema.warContributions.warId, warId))
        .orderBy(asc(schema.warContributions.guildId), desc(schema.warContributions.warPoints));

      // A war board is a sub-leaderboard: a guild's own captain / moderators may
      // reveal that guild's hidden members; everyone else sees "Anonymous".
      const adminRows = await orm
        .select({ guildId: schema.guildMembers.guildId })
        .from(schema.guildMembers)
        .where(
          and(
            inArray(schema.guildMembers.guildId, [challenger_guild_id, defender_guild_id]),
            eq(schema.guildMembers.userId, auth.user.sub),
            isNull(schema.guildMembers.leftAt),
            or(eq(schema.guildMembers.role, "captain"), eq(schema.guildMembers.isModerator, true))
          )
        );
      const revealGuilds = new Set(adminRows.map((r) => r.guildId));

      const masked = rows.map(({ is_anonymous, ...row }, i) =>
        maskLeaderboardRow(row, {
          anonymous: Boolean(is_anonymous),
          isSelf: row.user_id === auth.user.sub,
          canReveal: revealGuilds.has(row.guild_id),
          idKey: "user_id",
          masked: ANONYMOUS_SNAKE_IDENTITY,
          anonId: `anon-${row.guild_id}-${i}`,
        })
      );
      const challengerEntries = masked.filter((r) => r.guild_id === challenger_guild_id);
      const defenderEntries = masked.filter((r) => r.guild_id === defender_guild_id);

      return NextResponse.json({
        success: true,
        data: {
          warId,
          challenger: {
            guildId: challenger_guild_id,
            members: challengerEntries,
          },
          defender: {
            guildId: defender_guild_id,
            members: defenderEntries,
          },
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
