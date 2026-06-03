/**
 * app/api/users/[userId]/profile/route.ts
 *
 * Rich public profile endpoint consumed by the Expo profile screen.
 *
 * GET /api/users/[userId]/profile
 *   Returns a fully composed profile including:
 *     - Display info (avatar, name, city, "Playing since" year)
 *     - Rank tier, label, sub-level, prestige stars
 *     - Six track levels (Social, Creator, Competitor, Generosity, Knowledge, Explorer)
 *     - Guild badge (name, crest, id)
 *     - Creator card (bio, category) when is_creator
 *     - Social context: isFriend, isFollowing, isOwnProfile
 *     - Past seasons (up to 12 most recent)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getRankForXP } from "@/lib/xp/engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Map rank name to the five visual rank tiers used in the Expo UI. */
function getRankTier(rankName: string): string {
  const tier: Record<string, string> = {
    "Beginner":    "bronze",
    "Rookie":      "bronze",
    "Hustler":     "silver",
    "Baller":      "silver",
    "Boss":        "gold",
    "Legend":      "gold",
    "Titan":       "platinum",
    "Goat":        "platinum",
    "Icon":        "diamond",
    "Zobia Icon":  "diamond",
  };
  return tier[rankName] ?? "bronze";
}

/** Max track level used for the progress bar denominator. */
const TRACK_MAX_LEVEL = 100;

const TRACK_EMOJIS: Record<string, string> = {
  social:      "💬",
  creator:     "🎨",
  competitor:  "⚔️",
  generosity:  "🎁",
  knowledge:   "📚",
  explorer:    "🧭",
};

// ---------------------------------------------------------------------------
// Route params
// ---------------------------------------------------------------------------

interface UserParams {
  userId: string;
}

// ---------------------------------------------------------------------------
// GET /api/users/[userId]/profile
// ---------------------------------------------------------------------------

export const GET = withAuth<UserParams>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { userId } = params;
    if (!UUID_RE.test(userId)) throw badRequest("userId must be a valid UUID");

    const callerId = auth.user.sub;

    // 1. Main user row
    const { rows: userRows } = await db.query<{
      id: string;
      username: string | null;
      display_name: string | null;
      bio: string | null;
      avatar_emoji: string | null;
      city: string | null;
      xp_total: number;
      legacy_score: number;
      rank_name: string;
      rank_sublevel: number;
      prestige_count: number;
      level_social: number;
      level_creator: number;
      level_competitor: number;
      level_generosity: number;
      level_knowledge: number;
      level_explorer: number;
      is_creator: boolean;
      guild_id: string | null;
      created_at: string;
    }>(
      `SELECT id, username, display_name, bio, avatar_emoji, city,
              xp_total, COALESCE(legacy_score, 0) AS legacy_score,
              COALESCE(rank_name, 'Beginner') AS rank_name,
              COALESCE(rank_sublevel, 1) AS rank_sublevel,
              COALESCE(prestige_count, 0) AS prestige_count,
              COALESCE(level_social, 1) AS level_social,
              COALESCE(level_creator, 1) AS level_creator,
              COALESCE(level_competitor, 1) AS level_competitor,
              COALESCE(level_generosity, 1) AS level_generosity,
              COALESCE(level_knowledge, 1) AS level_knowledge,
              COALESCE(level_explorer, 1) AS level_explorer,
              COALESCE(is_creator, false) AS is_creator,
              guild_id,
              created_at
       FROM users
       WHERE id = $1
         AND deleted_at IS NULL
         AND onboarding_completed = true
         AND is_suspended = false
       LIMIT 1`,
      [userId]
    );

    const user = userRows[0];
    if (!user) throw notFound("User not found");

    // 2. Guild info
    let guildName: string | null = null;
    let guildCrest: string | null = null;
    let guildId: string | null = user.guild_id;

    if (user.guild_id) {
      const { rows: guildRows } = await db.query<{ name: string; crest_emoji: string | null }>(
        `SELECT name, crest_emoji FROM guilds WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [user.guild_id]
      );
      if (guildRows[0]) {
        guildName = guildRows[0].name;
        guildCrest = guildRows[0].crest_emoji ?? "🛡️";
      } else {
        guildId = null;
      }
    }

    // 3. Creator info
    let creatorBio: string | null = null;
    let creatorCategory: string | null = null;

    if (user.is_creator) {
      const { rows: creatorRows } = await db.query<{ bio: string | null; category: string | null }>(
        `SELECT bio, category FROM creator_profiles WHERE user_id = $1 LIMIT 1`,
        [userId]
      ).catch(() => ({ rows: [] as Array<{ bio: string | null; category: string | null }> }));
      if (creatorRows[0]) {
        creatorBio = creatorRows[0].bio;
        creatorCategory = creatorRows[0].category;
      }
    }

    // 4. Social context
    const isOwnProfile = callerId === userId;
    let isFriend = false;
    let isFollowing = false;

    if (!isOwnProfile) {
      const [friendRes, followRes] = await Promise.all([
        db.query<{ id: string }>(
          `SELECT id FROM friendships
           WHERE ((user_id_a = $1 AND user_id_b = $2) OR (user_id_a = $2 AND user_id_b = $1))
             AND status = 'accepted'
           LIMIT 1`,
          [callerId, userId]
        ).catch(() => ({ rows: [] as Array<{ id: string }> })),
        db.query<{ id: string }>(
          `SELECT id FROM follows WHERE follower_id = $1 AND following_id = $2 LIMIT 1`,
          [callerId, userId]
        ).catch(() => ({ rows: [] as Array<{ id: string }> })),
      ]);
      isFriend = friendRes.rows.length > 0;
      isFollowing = followRes.rows.length > 0;
    }

    // 5. Past seasons (up to 12 most recent)
    const { rows: seasonRows } = await db.query<{
      id: string;
      name: string;
      theme_emoji: string | null;
      ended_at: string | null;
      final_rank: number | null;
    }>(
      `SELECT s.id, s.name, s.theme_emoji, s.ended_at, usp.final_rank
       FROM user_season_participation usp
       JOIN seasons s ON s.id = usp.season_id
       WHERE usp.user_id = $1 AND s.ended_at IS NOT NULL
       ORDER BY s.ended_at DESC
       LIMIT 12`,
      [userId]
    ).catch(() => ({
      rows: [] as Array<{ id: string; name: string; theme_emoji: string | null; ended_at: string | null; final_rank: number | null }>,
    }));

    // 6. Compose rank info
    const rankInfo = getRankForXP(user.xp_total);

    // 7. Build response
    const profile = {
      userId: user.id,
      displayName: user.display_name ?? user.username ?? "Zobia User",
      username: user.username ?? "",
      avatarEmoji: user.avatar_emoji ?? "😊",
      city: user.city,
      joinedAt: user.created_at,
      rankTier: getRankTier(rankInfo.rankName),
      rankLabel: rankInfo.rankName,
      subLevel: rankInfo.sublevel,
      prestigeStars: user.prestige_count,
      legacyScore: user.legacy_score,
      trackLevels: [
        { track: "Social",     emoji: TRACK_EMOJIS.social,     level: user.level_social,     maxLevel: TRACK_MAX_LEVEL },
        { track: "Creator",    emoji: TRACK_EMOJIS.creator,    level: user.level_creator,    maxLevel: TRACK_MAX_LEVEL },
        { track: "Competitor", emoji: TRACK_EMOJIS.competitor, level: user.level_competitor, maxLevel: TRACK_MAX_LEVEL },
        { track: "Generosity", emoji: TRACK_EMOJIS.generosity, level: user.level_generosity, maxLevel: TRACK_MAX_LEVEL },
        { track: "Knowledge",  emoji: TRACK_EMOJIS.knowledge,  level: user.level_knowledge,  maxLevel: TRACK_MAX_LEVEL },
        { track: "Explorer",   emoji: TRACK_EMOJIS.explorer,   level: user.level_explorer,   maxLevel: TRACK_MAX_LEVEL },
      ],
      guildName,
      guildCrest,
      guildId,
      isCreator: user.is_creator,
      creatorBio,
      creatorCategory,
      isFriend,
      isFollowing,
      isOwnProfile,
      pastSeasons: seasonRows.map((s) => ({
        id: s.id,
        name: s.name,
        themeEmoji: s.theme_emoji ?? "🏆",
        year: s.ended_at ? new Date(s.ended_at).getFullYear() : new Date().getFullYear(),
        finalRank: s.final_rank ?? null,
      })),
    };

    return NextResponse.json({ profile }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
