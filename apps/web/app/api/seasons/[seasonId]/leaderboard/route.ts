export const dynamic = 'force-dynamic';

/**
 * app/api/seasons/[seasonId]/leaderboard/route.ts
 *
 * GET /api/seasons/[seasonId]/leaderboard
 *
 * Season leaderboard with pagination.
 * Query params:
 *   - scope : 'global' | 'city' | 'guild' (default: 'global')
 *   - page  : page number, 1-indexed (default: 1)
 *   - limit : max entries (default: 100, max: 200)
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import {
  getAnonymityConfig,
  hiddenOnLeaderboardSql,
  maskLeaderboardRow,
  ANONYMOUS_CAMEL_IDENTITY,
} from "@/lib/privacy/leaderboardAnonymity";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface SeasonLeaderboardRow {
  rank: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_emoji: string;
  rank_name: string;
  season_xp: number;
  city: string | null;
  guild_id: string | null;
  total_count: string;
  is_anonymous: boolean;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

/**
 * Cursor-paginated season leaderboard. Scoped to global, city, or guild.
 *
 * Leaderboards are ordered by rank (season_xp DESC, user_id ASC for tiebreak),
 * so the cursor uses (rank, user_id) to page forward through the ranked list.
 *
 * Cursor format: base64-encoded JSON { rank: number, user_id: string }
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { seasonId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { seasonId } = params;
      const { searchParams } = new URL(req.url);
      const scope = searchParams.get("scope") ?? "global";
      const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 200);
      const cursorParam = searchParams.get("cursor");

      // Decode cursor: base64-encoded JSON { rank: number, user_id: string }
      let cursorData: { rank: number; user_id: string } | null = null;
      if (cursorParam) {
        try {
          cursorData = JSON.parse(Buffer.from(cursorParam, "base64").toString()) as {
            rank: number;
            user_id: string;
          };
        } catch {
          // Invalid cursor — ignore and start from the beginning
        }
      }

      const db = await getDb();

      // Verify season exists
      const [seasonRow] = await db
        .select({ id: schema.seasons.id })
        .from(schema.seasons)
        .where(eq(schema.seasons.id, seasonId));
      if (!seasonRow) throw notFound("Season not found");

      let canReveal = false;

      // Build scope condition
      const conditions: ReturnType<typeof sql>[] = [
        sql`usp.season_id = ${seasonId}`,
        sql`u.deleted_at IS NULL`,
      ];

      if (scope === "city") {
        // Scope to the calling user's city
        const [userCityRow] = await db
          .select({ city: schema.users.city })
          .from(schema.users)
          .where(eq(schema.users.id, auth.user.sub));
        const city = userCityRow?.city ?? null;
        if (city) {
          conditions.push(sql`u.city = ${city}`);
        }
      } else if (scope === "guild") {
        // Scope to the calling user's guild
        const [userGuildRow] = await db
          .select({ guildId: schema.users.guildId })
          .from(schema.users)
          .where(eq(schema.users.id, auth.user.sub));
        const guildId = userGuildRow?.guildId ?? null;
        if (guildId) {
          conditions.push(sql`u.guild_id = ${guildId}`);
          // The guild board is a sub-leaderboard: the guild's own captain /
          // moderators may reveal members who chose to hide their name.
          const [membership] = await db
            .select({ role: schema.guildMembers.role, isModerator: schema.guildMembers.isModerator })
            .from(schema.guildMembers)
            .where(
              and(
                eq(schema.guildMembers.guildId, guildId),
                eq(schema.guildMembers.userId, auth.user.sub),
                isNull(schema.guildMembers.leftAt)
              )
            )
            .limit(1);
          canReveal = membership?.role === "captain" || membership?.isModerator === true;
        }
      }

      const where = sql.join(conditions, sql` AND `);
      const anonymityCfg = await getAnonymityConfig();

      // Use a CTE so the cursor condition can reference the computed rank.
      // Ranks are sorted ASC (rank 1 = top). Cursor pages forward: (rank, user_id) > cursor.
      const cursorCondition = cursorData
        ? sql`AND (ranked.rank, ranked.user_id) > (${String(cursorData.rank)}, ${cursorData.user_id})`
        : sql``;

      const result = await db.execute(sql`
        WITH ranked AS (
           SELECT
             ROW_NUMBER() OVER (ORDER BY usp.season_xp DESC, usp.user_id ASC) AS rank,
             usp.user_id,
             u.username,
             u.display_name,
             u.avatar_emoji,
             u.rank_name,
             usp.season_xp,
             u.city,
             u.guild_id,
             ${hiddenOnLeaderboardSql(anonymityCfg)} AS is_anonymous
           FROM user_season_passes usp
           JOIN users u ON u.id = usp.user_id
           WHERE ${where}
         )
         SELECT ranked.*, NULL::bigint AS total_count
         FROM ranked
         WHERE TRUE ${cursorCondition}
         ORDER BY ranked.rank ASC, ranked.user_id ASC
         LIMIT ${limit}
      `);
      const rows = result.rows as unknown as SeasonLeaderboardRow[];

      // Get calling user's rank
      const userRankResult = await db.execute(sql`
        SELECT COUNT(*) + 1 AS rank
         FROM user_season_passes usp
         JOIN users u ON u.id = usp.user_id
         WHERE usp.season_id = ${seasonId}
           AND usp.season_xp > COALESCE(
             (SELECT season_xp FROM user_season_passes WHERE user_id = ${auth.user.sub} AND season_id = ${seasonId} LIMIT 1), 0
           )
      `);
      const userRankRows = userRankResult.rows as unknown as Array<{ rank: string }>;

      // Produce the next cursor from the last item returned, if the page is full.
      const lastItem = rows[rows.length - 1];
      const nextCursor =
        lastItem && rows.length === limit
          ? Buffer.from(
              JSON.stringify({ rank: Number(lastItem.rank), user_id: lastItem.user_id })
            ).toString("base64")
          : null;

      return NextResponse.json({
        success: true,
        data: {
          entries: rows.map((r) =>
            maskLeaderboardRow(
              {
                rank: Number(r.rank),
                userId: r.user_id,
                username: r.username,
                displayName: r.display_name,
                avatarEmoji: r.avatar_emoji,
                rankName: r.rank_name,
                seasonXP: r.season_xp,
                city: r.city as string | null,
                guildId: r.guild_id,
              },
              {
                anonymous: Boolean(r.is_anonymous),
                isSelf: r.user_id === auth.user.sub,
                canReveal,
                idKey: "userId",
                masked: { ...ANONYMOUS_CAMEL_IDENTITY, city: null },
                anonId: `anon-${r.rank}`,
              }
            )
          ),
          userRank: parseInt(userRankRows[0]?.rank ?? "0") || null,
          hasMore: nextCursor !== null,
          nextCursor,
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
