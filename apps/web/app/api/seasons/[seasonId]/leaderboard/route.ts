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
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";

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

      // Verify season exists
      const seasonResult = await db.query<{ id: string }>(
        `SELECT id FROM seasons WHERE id = $1`,
        [seasonId]
      );
      if (!seasonResult.rows[0]) throw notFound("Season not found");

      // Build scope condition
      const conditions: string[] = [`usp.season_id = $1`, `u.deleted_at IS NULL`];
      const params2: (string | null)[] = [seasonId];
      let paramIdx = 2;

      if (scope === "city") {
        // Scope to the calling user's city
        const userCityResult = await db.query<{ city: string | null }>(
          `SELECT city FROM users WHERE id = $1`,
          [auth.user.sub]
        );
        const city = userCityResult.rows[0]?.city ?? null;
        if (city) {
          conditions.push(`u.city = $${paramIdx++}`);
          params2.push(city);
        }
      } else if (scope === "guild") {
        // Scope to the calling user's guild
        const userGuildResult = await db.query<{ guild_id: string | null }>(
          `SELECT guild_id FROM users WHERE id = $1`,
          [auth.user.sub]
        );
        const guildId = userGuildResult.rows[0]?.guild_id ?? null;
        if (guildId) {
          conditions.push(`u.guild_id = $${paramIdx++}`);
          params2.push(guildId);
        }
      }

      const where = `WHERE ${conditions.join(" AND ")}`;

      // Use a CTE so the cursor condition can reference the computed rank.
      // Ranks are sorted ASC (rank 1 = top). Cursor pages forward: (rank, user_id) > cursor.
      let cursorCondition = "";
      if (cursorData) {
        cursorCondition = `AND (ranked.rank, ranked.user_id) > ($${paramIdx++}, $${paramIdx++})`;
        params2.push(String(cursorData.rank), cursorData.user_id);
      }

      const limitParamIdx = paramIdx++;

      const { rows } = await db.query<SeasonLeaderboardRow>(
        `WITH ranked AS (
           SELECT
             ROW_NUMBER() OVER (ORDER BY usp.season_xp DESC, usp.user_id ASC) AS rank,
             usp.user_id,
             u.username,
             u.display_name,
             u.avatar_emoji,
             u.rank_name,
             usp.season_xp,
             u.city,
             u.guild_id
           FROM user_season_passes usp
           JOIN users u ON u.id = usp.user_id
           ${where}
         )
         SELECT ranked.*, NULL::bigint AS total_count
         FROM ranked
         WHERE TRUE ${cursorCondition}
         ORDER BY ranked.rank ASC, ranked.user_id ASC
         LIMIT $${limitParamIdx}`,
        [...params2, limit]
      );

      // Get calling user's rank
      const userRankResult = await db.query<{ rank: string }>(
        `SELECT COUNT(*) + 1 AS rank
         FROM user_season_passes usp
         JOIN users u ON u.id = usp.user_id
         WHERE usp.season_id = $1
           AND usp.season_xp > COALESCE(
             (SELECT season_xp FROM user_season_passes WHERE user_id = $2 AND season_id = $1 LIMIT 1), 0
           )`,
        [seasonId, auth.user.sub]
      );

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
          entries: rows.map((r) => ({
            rank: Number(r.rank),
            userId: r.user_id,
            username: r.username,
            displayName: r.display_name,
            avatarEmoji: r.avatar_emoji,
            rankName: r.rank_name,
            seasonXP: r.season_xp,
            city: r.city,
            guildId: r.guild_id,
          })),
          userRank: parseInt(userRankResult.rows[0]?.rank ?? "0") || null,
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
