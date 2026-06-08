export const dynamic = 'force-dynamic';

/**
 * app/api/guilds/wars/[warId]/route.ts
 *
 * Live war status endpoint.
 *
 * GET /api/guilds/wars/[warId]
 *   - Returns full war status including both guilds' points, time remaining,
 *     and whether the Final Hour is active.
 *
 * GET /api/guilds/wars/[warId]/leaderboard
 *   - Individual member contribution scores for both guilds in this war.
 *   - Handled in a separate route segment (/leaderboard/route.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface WarDetailRow {
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
  challenger_name: string;
  challenger_crest: string;
  challenger_tier: string;
  challenger_guild_xp: number;
  defender_name: string;
  defender_crest: string;
  defender_tier: string;
  defender_guild_xp: number;
}

// ---------------------------------------------------------------------------
// GET /api/guilds/wars/[warId]
// ---------------------------------------------------------------------------

/**
 * Fetch live war status.
 *
 * Returns both sides' point totals, time remaining (in seconds),
 * whether the Final Hour is active, and both guild profiles.
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    { params }: { params: { warId: string } }
  ) => {
    try {
      const { warId } = params;

      const { rows } = await db.query<WarDetailRow>(
        `SELECT
           gw.id, gw.challenger_guild_id, gw.defender_guild_id, gw.status,
           gw.challenger_points, gw.defender_points, gw.winner_guild_id,
           gw.starts_at, gw.ends_at, gw.final_hour_starts_at, gw.created_at,
           cg.name AS challenger_name,
           cg.crest_emoji AS challenger_crest,
           cg.tier AS challenger_tier,
           cg.guild_xp AS challenger_guild_xp,
           dg.name AS defender_name,
           dg.crest_emoji AS defender_crest,
           dg.tier AS defender_tier,
           dg.guild_xp AS defender_guild_xp
         FROM guild_wars gw
         JOIN guilds cg ON cg.id = gw.challenger_guild_id
         JOIN guilds dg ON dg.id = gw.defender_guild_id
         WHERE gw.id = $1`,
        [warId]
      );

      const war = rows[0];
      if (!war) throw notFound("War not found");

      const now = Date.now();
      const endsAt = new Date(war.ends_at).getTime();
      const finalHourStartsAt = new Date(war.final_hour_starts_at).getTime();

      const secondsRemaining = Math.max(0, Math.floor((endsAt - now) / 1000));
      const isFinalHour = now >= finalHourStartsAt && now < endsAt;

      return NextResponse.json({
        success: true,
        data: {
          war: {
            id: war.id,
            status: war.status,
            startsAt: war.starts_at,
            endsAt: war.ends_at,
            finalHourStartsAt: war.final_hour_starts_at,
            secondsRemaining,
            isFinalHour,
            winnerGuildId: war.winner_guild_id,
          },
          challenger: {
            guildId: war.challenger_guild_id,
            name: war.challenger_name,
            crestEmoji: war.challenger_crest,
            tier: war.challenger_tier,
            guildXP: war.challenger_guild_xp,
            points: war.challenger_points,
          },
          defender: {
            guildId: war.defender_guild_id,
            name: war.defender_name,
            crestEmoji: war.defender_crest,
            tier: war.defender_tier,
            guildXP: war.defender_guild_xp,
            points: war.defender_points,
          },
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
