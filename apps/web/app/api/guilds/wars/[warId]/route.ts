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
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db/drizzle";
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

      const orm = await getDb();
      const cg = alias(schema.guilds, "cg");
      const dg = alias(schema.guilds, "dg");
      const dbRows = await orm
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
          challenger_name: cg.name,
          challenger_crest: cg.crestEmoji,
          challenger_tier: cg.tier,
          challenger_guild_xp: cg.guildXp,
          defender_name: dg.name,
          defender_crest: dg.crestEmoji,
          defender_tier: dg.tier,
          defender_guild_xp: dg.guildXp,
        })
        .from(schema.guildWars)
        .innerJoin(cg, eq(cg.id, schema.guildWars.challengerGuildId))
        .innerJoin(dg, eq(dg.id, schema.guildWars.defenderGuildId))
        .where(eq(schema.guildWars.id, warId))
        .limit(1);

      const warRow = dbRows[0];
      if (!warRow) throw notFound("War not found");
      const war: WarDetailRow = {
        ...warRow,
        challenger_points: Number(warRow.challenger_points),
        defender_points: Number(warRow.defender_points),
        starts_at: warRow.starts_at.toISOString(),
        ends_at: warRow.ends_at.toISOString(),
        final_hour_starts_at: warRow.final_hour_starts_at.toISOString(),
        created_at: warRow.created_at ? warRow.created_at.toISOString() : new Date().toISOString(),
        challenger_guild_xp: Number(warRow.challenger_guild_xp),
        defender_guild_xp: Number(warRow.defender_guild_xp),
      };

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
