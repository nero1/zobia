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
import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";

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
    { params }: { params: { warId: string } }
  ) => {
    try {
      const { warId } = params;

      const orm = await getDb();
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
        })
        .from(schema.warContributions)
        .innerJoin(schema.users, eq(schema.users.id, schema.warContributions.userId))
        .where(eq(schema.warContributions.warId, warId))
        .orderBy(asc(schema.warContributions.guildId), desc(schema.warContributions.warPoints));

      const challengerEntries = rows.filter((r) => r.guild_id === challenger_guild_id);
      const defenderEntries = rows.filter((r) => r.guild_id === defender_guild_id);

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
