export const dynamic = 'force-dynamic';

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
import { isAdminOrModerator } from "@/lib/auth/roles";
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

/** Hex color for the rank ring on the profile page. */
const RANK_COLORS: Record<string, string> = {
  "Beginner":   "#9CA3AF",
  "Rookie":     "#78716C",
  "Hustler":    "#6B7280",
  "Baller":     "#059669",
  "Boss":       "#2563EB",
  "Legend":     "#7C3AED",
  "Titan":      "#EA580C",
  "Goat":       "#DC2626",
  "Icon":       "#D97706",
  "Zobia Icon": "#FFD700",
};

/** Max track level used for the progress bar denominator. */
const TRACK_MAX_LEVEL = 100;

const TRACK_EMOJIS: Record<string, string> = {
  social:      "💬",
  creator:     "🎨",
  competitor:  "⚔️",
  generosity:  "🎁",
  knowledge:   "📚",
  explorer:    "🧭",
  gaming:      "🎮",
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
      level_gaming: number;
      is_creator: boolean;
      creator_tier: string | null;
      guild_id: string | null;
      created_at: string;
      custom_crest: string | null;
      is_suspended: boolean;
      is_banned: boolean;
      profile_private: boolean;
      profile_hidden_sections: string[];
      disable_friend_requests: boolean;
      plan: string | null;
      is_moderator: boolean;
      is_verified: boolean;
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
              COALESCE(level_gaming, 1) AS level_gaming,
              COALESCE(is_creator, false) AS is_creator,
              creator_tier,
              guild_id,
              created_at,
              custom_crest,
              COALESCE(is_suspended, false) AS is_suspended,
              COALESCE(is_banned, false) AS is_banned,
              COALESCE(profile_private, false) AS profile_private,
              COALESCE(profile_hidden_sections, '[]'::jsonb) AS profile_hidden_sections,
              COALESCE(disable_friend_requests, false) AS disable_friend_requests,
              COALESCE(plan, 'free') AS plan,
              COALESCE(is_moderator, false) AS is_moderator,
              COALESCE(is_verified, false) AS is_verified
       FROM users
       WHERE id = $1
         AND deleted_at IS NULL
         AND onboarding_completed = true
       LIMIT 1`,
      [userId]
    );

    const user = userRows[0];
    if (!user) throw notFound("User not found");

    const isOwnProfileCheck = callerId === userId;

    // Check for banned/suspended account (admin can always view)
    if (!isOwnProfileCheck) {
      if (user.is_banned) {
        return NextResponse.json({ error: "This account has been restricted.", code: "ACCOUNT_RESTRICTED" }, { status: 403 });
      }
      if (user.is_suspended) {
        return NextResponse.json({ error: "This account is temporarily suspended.", code: "ACCOUNT_SUSPENDED" }, { status: 403 });
      }
    }

    // Private profile check (skip for own profile)
    if (!isOwnProfileCheck && user.profile_private) {
      // Allow friends to still view
      const { rows: friendRows } = await db.query<{ id: string }>(
        `SELECT id FROM friendships
         WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
           AND status = 'accepted'
         LIMIT 1`,
        [callerId, userId]
      ).catch(() => ({ rows: [] as Array<{ id: string }> }));
      if (friendRows.length === 0) {
        return NextResponse.json({ error: "This profile is private.", code: "PROFILE_PRIVATE" }, { status: 403 });
      }
    }

    const hiddenSections: string[] = Array.isArray(user.profile_hidden_sections)
      ? user.profile_hidden_sections
      : [];

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

    // 2b. Alliance trophy — surface the user's alliance and its wars won (PRD §13)
    let allianceTrophy: { allianceName: string; warsWon: number } | null = null;
    if (user.guild_id) {
      const { rows: allianceRows } = await db.query<{ name: string; wars_won: number }>(
        `SELECT ga.name, ga.wars_won
         FROM guild_alliance_members gam
         JOIN guild_alliances ga ON ga.id = gam.alliance_id
         WHERE gam.guild_id = $1 AND ga.is_active = true
         LIMIT 1`,
        [user.guild_id]
      ).catch(() => ({ rows: [] as Array<{ name: string; wars_won: number }> }));
      if (allianceRows[0]) {
        allianceTrophy = { allianceName: allianceRows[0].name, warsWon: allianceRows[0].wars_won };
      }
    }

    // 3. Creator info — bio is on the users table; category maps from creator_tier
    const creatorBio: string | null = user.is_creator ? (user.bio ?? null) : null;
    const CREATOR_TIER_LABELS: Record<string, string> = {
      rookie:   "Rookie Creator",
      rising:   "Rising Creator",
      verified: "Verified Creator",
      elite:    "Elite Creator",
      icon:     "Zobia Icon Creator",
    };
    const creatorCategory: string | null = user.is_creator && user.creator_tier
      ? (CREATOR_TIER_LABELS[user.creator_tier] ?? user.creator_tier)
      : null;

    // 4. Social context
    const isOwnProfile = isOwnProfileCheck;
    let isFriend = false;
    let isFollowing = false;

    if (!isOwnProfile) {
      const [friendRes, followRes] = await Promise.all([
        db.query<{ id: string }>(
          `SELECT id FROM friendships
           WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
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

    // Stats page visibility (PRD §15): only the profile owner or a
    // moderator/admin viewer may open this user's Stats page.
    const canViewStats = isOwnProfile || (await isAdminOrModerator(callerId));

    // 5. Creator card — top rooms + subscriber count (PRD §15)
    let creatorRoom: { id: string; name: string; coverEmoji: string } | null = null;
    let creatorRooms: { id: string; name: string; coverEmoji: string; memberCount: number }[] = [];
    let creatorRoomCount = 0;
    let subscriberCount: number | null = null;
    let totalEarningsKobo: number | null = null;

    if (user.is_creator) {
      const [roomRes, earningsRes] = await Promise.all([
        // total_count comes from the same query/row-set as the top-3 rooms
        // (COUNT(*) OVER()) rather than a second, independently-failing
        // query — so the "see all N rooms" link can never disagree with
        // the rooms actually returned.
        db.query<{ id: string; name: string; cover_emoji: string; member_count: number; total_count: string }>(
          `SELECT id, name, cover_emoji, member_count, COUNT(*) OVER() AS total_count FROM rooms
           WHERE creator_id = $1 AND is_active = TRUE
           ORDER BY member_count DESC LIMIT 3`,
          [userId]
        ).catch(() => ({ rows: [] as Array<{ id: string; name: string; cover_emoji: string; member_count: number; total_count: string }> })),
        db.query<{ subscriber_count: string; total_earnings_kobo: string }>(
          `SELECT
             COUNT(DISTINCT rm.user_id)::TEXT AS subscriber_count,
             COALESCE(SUM(ce.gross_amount_kobo), 0)::TEXT AS total_earnings_kobo
           FROM rooms r
           LEFT JOIN room_members rm ON rm.room_id = r.id
           LEFT JOIN creator_earnings ce ON ce.creator_id = $1
           WHERE r.creator_id = $1 AND r.is_active = TRUE`,
          [userId]
        ).catch(() => ({ rows: [] as Array<{ subscriber_count: string; total_earnings_kobo: string }> })),
      ]);

      creatorRoom = roomRes.rows[0]
        ? { id: roomRes.rows[0].id, name: roomRes.rows[0].name, coverEmoji: roomRes.rows[0].cover_emoji }
        : null;
      creatorRooms = roomRes.rows.map((r) => ({ id: r.id, name: r.name, coverEmoji: r.cover_emoji, memberCount: r.member_count }));
      creatorRoomCount = parseInt(roomRes.rows[0]?.total_count ?? "0", 10);
      subscriberCount = earningsRes.rows[0] ? parseInt(earningsRes.rows[0].subscriber_count, 10) : 0;
      // Only expose total earnings to the profile owner (privacy gate)
      totalEarningsKobo = isOwnProfile && earningsRes.rows[0]
        ? parseInt(earningsRes.rows[0].total_earnings_kobo, 10)
        : null;
    }

    // 5b. Connection badge — check if viewer has an active DM connection badge with this user (PRD §5/§15)
    let connectionBadge: string | null = null;
    if (!isOwnProfile) {
      try {
        const { rows: badgeRows } = await db.query<{ streak_days: number; tier: string }>(
          `SELECT conversation_score AS streak_days,
                  CASE
                    WHEN conversation_score >= 30 THEN 'Platinum Bond'
                    WHEN conversation_score >= 14 THEN 'Gold Connection'
                    WHEN conversation_score >= 7  THEN 'Connected'
                    ELSE NULL
                  END AS tier
           FROM dm_conversations
           WHERE (user_id_1 = LEAST($1::text,$2::text) AND user_id_2 = GREATEST($1::text,$2::text))
             AND conversation_score >= 7
           LIMIT 1`,
          [callerId, userId]
        );
        connectionBadge = badgeRows[0]?.tier ?? null;
      } catch {
        // Non-fatal — dm_conversations may not have conversation_score yet
      }
    }

    // 5c. Public Achievements Wall — top lifetime milestones (PRD §15)
    const { rows: achievementRows } = await db.query<{
      badge_key: string;
      badge_type: string;
      awarded_at: string;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT badge_key, badge_type, awarded_at, metadata
       FROM user_badges
       WHERE user_id = $1
       ORDER BY awarded_at ASC
       LIMIT 12`,
      [userId]
    ).catch(() => ({
      rows: [] as Array<{ badge_key: string; badge_type: string; awarded_at: string; metadata: Record<string, unknown> | null }>,
    }));

    // 6. Past seasons (up to 12 most recent)
    const { rows: seasonRows } = await db.query<{
      id: string;
      name: string;
      theme_emoji: string | null;
      ended_at: string | null;
      final_rank: number | null;
    }>(
      `SELECT s.id, s.name, s.theme_emoji, s.ended_at, sra.final_rank
       FROM season_rank_archives sra
       JOIN seasons s ON s.id = sra.season_id
       WHERE sra.user_id = $1 AND s.ended_at IS NOT NULL
       ORDER BY s.ended_at DESC
       LIMIT 12`,
      [userId]
    ).catch(() => ({
      rows: [] as Array<{ id: string; name: string; theme_emoji: string | null; ended_at: string | null; final_rank: number | null }>,
    }));

    // 7. Compose rank info
    const rankInfo = getRankForXP(user.xp_total);

    // 8. Build response (apply hidden sections for non-owners)
    const hidden = isOwnProfile ? [] : hiddenSections;

    const rankName = rankInfo.rankName;
    const rankColor = RANK_COLORS[rankName] ?? "#9CA3AF";

    const trackLevels = hidden.includes("xp") ? [] : [
      { track: "Social",     label: "Social",     emoji: TRACK_EMOJIS.social,     level: user.level_social,     maxLevel: TRACK_MAX_LEVEL },
      { track: "Creator",    label: "Creator",    emoji: TRACK_EMOJIS.creator,    level: user.level_creator,    maxLevel: TRACK_MAX_LEVEL },
      { track: "Competitor", label: "Competitor", emoji: TRACK_EMOJIS.competitor, level: user.level_competitor, maxLevel: TRACK_MAX_LEVEL },
      { track: "Generosity", label: "Generosity", emoji: TRACK_EMOJIS.generosity, level: user.level_generosity, maxLevel: TRACK_MAX_LEVEL },
      { track: "Knowledge",  label: "Knowledge",  emoji: TRACK_EMOJIS.knowledge,  level: user.level_knowledge,  maxLevel: TRACK_MAX_LEVEL },
      { track: "Explorer",   label: "Explorer",   emoji: TRACK_EMOJIS.explorer,   level: user.level_explorer,   maxLevel: TRACK_MAX_LEVEL },
      { track: "Gaming",     label: "Gaming",     emoji: TRACK_EMOJIS.gaming,     level: user.level_gaming,     maxLevel: TRACK_MAX_LEVEL },
    ];

    const seasonHistory = hidden.includes("seasons") ? [] : seasonRows.map((s) => ({
      id: s.id,
      name: s.name,
      themeEmoji: s.theme_emoji ?? "🏆",
      year: s.ended_at ? new Date(s.ended_at).getFullYear() : new Date().getFullYear(),
      finalRank: s.final_rank ?? null,
      // Web profile page compat aliases
      rank: s.final_rank ?? 0,
      tier: getRankTier(rankName),
    }));

    const profile = {
      // Primary ID (web profile page uses 'id')
      id: user.id,
      userId: user.id,
      displayName: hidden.includes("display_name") ? null : (user.display_name ?? user.username ?? "Zobia User"),
      username: user.username ?? "",
      isVerified: user.is_verified,
      avatarEmoji: hidden.includes("avatar") ? null : (user.avatar_emoji ?? "😊"),
      city: user.city,
      joinedAt: user.created_at,
      // Rank info — both legacy names and web-page names
      rankTier: hidden.includes("rank") ? null : getRankTier(rankName),
      rankLabel: hidden.includes("rank") ? null : rankName,
      rankName: hidden.includes("rank") ? null : rankName,
      rankColor: hidden.includes("rank") ? null : rankColor,
      subLevel: hidden.includes("rank") ? null : rankInfo.sublevel,
      rankLevel: hidden.includes("rank") ? null : rankInfo.sublevel,
      // XP progress
      xp: hidden.includes("xp") ? null : user.xp_total,
      xpForNextRank: hidden.includes("xp") ? null : (rankInfo.nextRankXp ?? 0),
      // Prestige — both names
      prestigeStars: user.prestige_count,
      prestige: user.prestige_count,
      legacyScore: user.legacy_score,
      plan: user.plan ?? "free",
      isModerator: user.is_moderator,
      // Track levels — both old shape (trackLevels) and new shape (tracks)
      trackLevels,
      tracks: trackLevels,
      // Guild — both names
      guildName: hidden.includes("guild") ? null : guildName,
      guildCrest: hidden.includes("guild") ? null : guildCrest,
      guildEmblem: hidden.includes("guild") ? null : guildCrest,
      guildId: hidden.includes("guild") ? null : guildId,
      // Alliance trophy — shown on profile when user belongs to an alliance (PRD §13)
      allianceTrophy,
      isCreator: user.is_creator,
      creatorBio,
      creatorCategory,
      // Creator card (PRD §15): room link, subscriber count, optional earnings
      creatorRoom,
      // Top 3 rooms by member count + total active room count, with a
      // "see all rooms by this creator" link driven by creatorRoomCount.
      creatorRooms,
      creatorRoomCount,
      subscriberCount,
      totalEarningsKobo,
      // Stats page visibility (PRD §15) — only the owner or a moderator/admin viewer.
      canViewStats,
      // Connection badge visible on profile (PRD §5/§15)
      connectionBadge,
      // Public Achievements Wall (PRD §15)
      achievements: hidden.includes("badges") ? [] : achievementRows.map((a) => ({
        key: a.badge_key,
        type: a.badge_type,
        grantedAt: a.awarded_at,
        label: (a.metadata as Record<string, string> | null)?.title ?? a.badge_key.replace(/_/g, " "),
      })),
      isFriend,
      isFollowing,
      isOwnProfile,
      disableFriendRequests: !isOwnProfile ? user.disable_friend_requests : false,
      // Hall of Fame custom crest (PRD §9 — Prestige 10 exclusive)
      customCrest: user.custom_crest ?? null,
      isHallOfFame: user.prestige_count >= 10,
      // Season history — both old shape (pastSeasons) and new shape (seasonHistory)
      pastSeasons: seasonHistory,
      seasonHistory,
    };

    return NextResponse.json({ profile }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
