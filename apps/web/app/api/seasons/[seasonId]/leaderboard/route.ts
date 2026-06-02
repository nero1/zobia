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
 * Paginated season leaderboard. Scoped to global, city, or guild.
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
      const page = Math.max(parseInt(searchParams.get("page") ?? "1"), 1);
      const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 200);
      const offset = (page - 1) * limit;

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

      const { rows } = await db.query<SeasonLeaderboardRow>(
        `SELECT
           ROW_NUMBER() OVER (ORDER BY usp.season_xp DESC) AS rank,
           usp.user_id,
           u.username,
           u.display_name,
           u.avatar_emoji,
           u.rank_name,
           usp.season_xp,
           u.city,
           u.guild_id,
           COUNT(*) OVER () AS total_count
         FROM user_season_passes usp
         JOIN users u ON u.id = usp.user_id
         ${where}
         ORDER BY usp.season_xp DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params2, limit, offset]
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

      const total = parseInt(rows[0]?.total_count ?? "0");

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
          total,
          page,
          hasMore: offset + limit < total,
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
