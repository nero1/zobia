/**
 * app/api/guilds/wars/[warId]/leaderboard/route.ts
 *
 * GET /api/guilds/wars/[warId]/leaderboard
 *
 * Returns individual member contribution scores for both guilds in this war,
 * sorted by war_points descending within each guild.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
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

      const warResult = await db.query<WarGuildsRow>(
        `SELECT challenger_guild_id, defender_guild_id FROM guild_wars WHERE id = $1`,
        [warId]
      );
      if (!warResult.rows[0]) throw notFound("War not found");

      const { challenger_guild_id, defender_guild_id } = warResult.rows[0];

      const { rows } = await db.query<ContributionRow>(
        `SELECT wc.user_id, wc.guild_id, wc.war_points,
                u.username, u.display_name, u.avatar_emoji, u.rank_name
         FROM war_contributions wc
         JOIN users u ON u.id = wc.user_id
         WHERE wc.war_id = $1
         ORDER BY wc.guild_id, wc.war_points DESC`,
        [warId]
      );

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
