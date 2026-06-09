export const dynamic = 'force-dynamic';

/**
 * app/api/guilds/discovery/route.ts
 *
 * Guild Discovery Panel API.
 *
 * GET /api/guilds/discovery
 *   - Returns up to 3 recommended guilds based on the authenticated user's city
 *   - Filters to guilds that are open or approval-required (not invite-only)
 *   - Excludes guilds the user is already a member of
 *   - Orders by: same city first, then member_count DESC, then guild_xp DESC
 *   - Returns: id, name, crest_emoji, description, city, member_count,
 *              guild_xp, tier, war_wins, is_recruiting
 *
 * This endpoint is consumed by:
 *  - The Expo home tab "Crews near you are recruiting" panel (shown after 24h)
 *  - The Guild Discovery Panel triggered by the guild_discovery CRON notification
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuildDiscoveryRow {
  id: string;
  name: string;
  crest_emoji: string;
  description: string | null;
  city: string | null;
  member_count: number;
  guild_xp: number;
  tier: string;
  wars_won: number;
  is_recruiting: boolean;
  same_city: boolean;
}

// ---------------------------------------------------------------------------
// GET /api/guilds/discovery
// ---------------------------------------------------------------------------

/**
 * Recommend up to 3 guilds for the authenticated user.
 *
 * Priority:
 *  1. Guilds in the same city as the user
 *  2. Larger guilds (member_count DESC)
 *  3. More experienced guilds (guild_xp DESC)
 *
 * Only open or approval-required guilds are returned (not invite_only).
 * Guilds the user already belongs to are excluded.
 */
export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    // PRD §4 Step 5: Guild Discovery is shown only after the user's first 24 hours
    const { rows: userWithAge } = await db.query<{
      city: string | null;
      guild_id: string | null;
      created_at: string;
      guild_emphasis: string | null;
    }>(
      `SELECT u.city, u.guild_id, u.created_at, op.guild_emphasis
       FROM users u
       LEFT JOIN onboarding_personalization op ON op.user_id = u.id
       WHERE u.id = $1 AND u.deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    const user = userWithAge[0];
    const accountAgeHours = user ? (Date.now() - new Date(user.created_at).getTime()) / 3_600_000 : 999;

    if (accountAgeHours < 24) {
      return NextResponse.json({
        success: true,
        data: { guilds: [], userCity: user?.city ?? null, tooNew: true },
        error: null,
      }, { status: 200 });
    }

    const userCity = user?.city ?? null;
    const guildEmphasis = (user?.guild_emphasis as 'guild' | 'solo' | null) ?? null;
    const soloNote =
      guildEmphasis === 'solo'
        ? "You can explore Zobia solo — but crew members earn up to 50% more XP on the same actions."
        : null;

    // 1. Find guilds the user is already a member of (covers multi-guild edge case)
    const { rows: membershipRows } = await db.query<{ guild_id: string }>(
      `SELECT guild_id FROM guild_members WHERE user_id = $1`,
      [userId]
    );
    const memberGuildIds = membershipRows.map((r) => r.guild_id);

    // Always exclude the user's primary guild_id if set
    if (user?.guild_id && !memberGuildIds.includes(user.guild_id)) {
      memberGuildIds.push(user.guild_id);
    }

    // 2. Query recommended guilds
    //    Excludes invite_only and guilds the user is already in.
    //    Orders: same city first, then member_count DESC, then guild_xp DESC.
    const { rows: guilds } = await db.query<GuildDiscoveryRow>(
      `SELECT
         g.id,
         g.name,
         g.crest_emoji,
         g.description,
         g.city,
         g.member_count,
         g.guild_xp,
         g.tier,
         g.wars_won,
         (g.recruitment_type != 'invite_only') AS is_recruiting,
         CASE
           WHEN $1::text IS NOT NULL AND g.city ILIKE $1 THEN TRUE
           ELSE FALSE
         END AS same_city
       FROM guilds g
       WHERE g.is_active = TRUE
         AND g.recruitment_type IN ('open', 'approval')
         ${memberGuildIds.length > 0 ? `AND g.id != ALL($2::uuid[])` : ""}
       ORDER BY
         same_city DESC,
         g.member_count DESC,
         g.guild_xp DESC
       LIMIT 3`,
      memberGuildIds.length > 0
        ? [userCity, memberGuildIds]
        : [userCity]
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          guilds: guilds.map((g) => ({
            id: g.id,
            name: g.name,
            crestEmoji: g.crest_emoji,
            description: g.description,
            city: g.city,
            memberCount: g.member_count,
            guildXp: g.guild_xp,
            tier: g.tier,
            warWins: g.wars_won,
            isRecruiting: g.is_recruiting,
            sameCity: g.same_city,
          })),
          userCity,
          guildEmphasis,
          soloNote,
        },
        error: null,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
