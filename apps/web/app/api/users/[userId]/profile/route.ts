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
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getStaffRoles } from "@/lib/auth/roles";
import { getRankForXP } from "@/lib/xp/engine";
import { loadManifest } from "@/lib/manifest";
import { isFeatureAccessible } from "@/lib/manifest/featureAccess";
import { getProfileTheme, DEFAULT_PROFILE_THEME_TOKENS } from "@/lib/profile/themes";

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

/** XP required per track level — matches app/(app)/profile/page.tsx's own-profile TrackBar. */
const XP_PER_TRACK_LEVEL = 1000;

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
    const db = await getDb();
    const [userRow] = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        bio: schema.users.bio,
        avatarEmoji: schema.users.avatarEmoji,
        city: schema.users.city,
        activeProfileThemeId: schema.users.activeProfileThemeId,
        xpTotal: schema.users.xpTotal,
        legacyScore: schema.users.legacyScore,
        rankName: schema.users.rankName,
        rankSublevel: schema.users.rankSublevel,
        prestigeCount: schema.users.prestigeCount,
        levelSocial: schema.users.levelSocial,
        levelCreator: schema.users.levelCreator,
        levelCompetitor: schema.users.levelCompetitor,
        levelGenerosity: schema.users.levelGenerosity,
        levelKnowledge: schema.users.levelKnowledge,
        levelExplorer: schema.users.levelExplorer,
        levelGaming: schema.users.levelGaming,
        xpSocial: schema.users.xpSocial,
        xpCreator: schema.users.xpCreator,
        xpCompetitor: schema.users.xpCompetitor,
        xpGenerosity: schema.users.xpGenerosity,
        xpKnowledge: schema.users.xpKnowledge,
        xpExplorer: schema.users.xpExplorer,
        xpGaming: schema.users.xpGaming,
        loginStreak: schema.users.loginStreak,
        longestStreak: schema.users.longestStreak,
        isCreator: schema.users.isCreator,
        creatorTier: schema.users.creatorTier,
        guildId: schema.users.guildId,
        createdAt: schema.users.createdAt,
        customCrest: schema.users.customCrest,
        isSuspended: schema.users.isSuspended,
        isBanned: schema.users.isBanned,
        profilePrivate: schema.users.profilePrivate,
        profileHiddenSections: schema.users.profileHiddenSections,
        disableFriendRequests: schema.users.disableFriendRequests,
        plan: schema.users.plan,
        isModerator: schema.users.isModerator,
        isVerified: schema.users.isVerified,
      })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, userId),
          isNull(schema.users.deletedAt),
          eq(schema.users.onboardingCompleted, true)
        )
      )
      .limit(1);

    if (!userRow) throw notFound("User not found");

    const user = {
      id: userRow.id,
      username: userRow.username,
      display_name: userRow.displayName,
      bio: userRow.bio,
      avatar_emoji: userRow.avatarEmoji,
      city: userRow.city,
      active_profile_theme_id: userRow.activeProfileThemeId ?? "classic",
      xp_total: Number(userRow.xpTotal),
      legacy_score: Number(userRow.legacyScore ?? 0),
      rank_name: userRow.rankName ?? "Beginner",
      rank_sublevel: userRow.rankSublevel ?? 1,
      prestige_count: userRow.prestigeCount ?? 0,
      level_social: userRow.levelSocial ?? 1,
      level_creator: userRow.levelCreator ?? 1,
      level_competitor: userRow.levelCompetitor ?? 1,
      level_generosity: userRow.levelGenerosity ?? 1,
      level_knowledge: userRow.levelKnowledge ?? 1,
      level_explorer: userRow.levelExplorer ?? 1,
      level_gaming: userRow.levelGaming ?? 1,
      xp_social: Number(userRow.xpSocial ?? 0),
      xp_creator: Number(userRow.xpCreator ?? 0),
      xp_competitor: Number(userRow.xpCompetitor ?? 0),
      xp_generosity: Number(userRow.xpGenerosity ?? 0),
      xp_knowledge: Number(userRow.xpKnowledge ?? 0),
      xp_explorer: Number(userRow.xpExplorer ?? 0),
      xp_gaming: Number(userRow.xpGaming ?? 0),
      login_streak: userRow.loginStreak ?? 0,
      longest_streak: userRow.longestStreak ?? 0,
      is_creator: userRow.isCreator ?? false,
      creator_tier: userRow.creatorTier,
      guild_id: userRow.guildId,
      created_at: userRow.createdAt ? userRow.createdAt.toISOString() : "",
      custom_crest: userRow.customCrest,
      is_suspended: userRow.isSuspended ?? false,
      is_banned: userRow.isBanned ?? false,
      profile_private: userRow.profilePrivate ?? false,
      profile_hidden_sections: Array.isArray(userRow.profileHiddenSections)
        ? (userRow.profileHiddenSections as string[])
        : [],
      disable_friend_requests: userRow.disableFriendRequests ?? false,
      plan: userRow.plan ?? "free",
      is_moderator: userRow.isModerator ?? false,
      is_verified: userRow.isVerified ?? false,
    };

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
      const friendRows = await db
        .select({ id: schema.friendships.id })
        .from(schema.friendships)
        .where(
          and(
            or(
              and(eq(schema.friendships.requesterId, callerId), eq(schema.friendships.addresseeId, userId)),
              and(eq(schema.friendships.requesterId, userId), eq(schema.friendships.addresseeId, callerId))
            ),
            eq(schema.friendships.status, "accepted")
          )
        )
        .limit(1)
        .catch(() => [] as Array<{ id: string }>);
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
      const [guildRow] = await db
        .select({ name: schema.guilds.name, crestEmoji: schema.guilds.crestEmoji })
        .from(schema.guilds)
        .where(and(eq(schema.guilds.id, user.guild_id), isNull(schema.guilds.deletedAt)))
        .limit(1);
      if (guildRow) {
        guildName = guildRow.name;
        guildCrest = guildRow.crestEmoji ?? "🛡️";
      } else {
        guildId = null;
      }
    }

    // 2b. Alliance trophy — surface the user's alliance and its wars won (PRD §13)
    let allianceTrophy: { allianceName: string; warsWon: number } | null = null;
    if (user.guild_id) {
      const allianceRows = await db
        .select({ name: schema.guildAlliances.name, warsWon: schema.guildAlliances.warsWon })
        .from(schema.guildAllianceMembers)
        .innerJoin(schema.guildAlliances, eq(schema.guildAlliances.id, schema.guildAllianceMembers.allianceId))
        .where(and(eq(schema.guildAllianceMembers.guildId, user.guild_id), eq(schema.guildAlliances.isActive, true)))
        .limit(1)
        .catch(() => [] as Array<{ name: string; warsWon: number }>);
      if (allianceRows[0]) {
        allianceTrophy = { allianceName: allianceRows[0].name, warsWon: allianceRows[0].warsWon };
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
      const [friendRows, followRows] = await Promise.all([
        db
          .select({ id: schema.friendships.id })
          .from(schema.friendships)
          .where(
            and(
              or(
                and(eq(schema.friendships.requesterId, callerId), eq(schema.friendships.addresseeId, userId)),
                and(eq(schema.friendships.requesterId, userId), eq(schema.friendships.addresseeId, callerId))
              ),
              eq(schema.friendships.status, "accepted")
            )
          )
          .limit(1)
          .catch(() => [] as Array<{ id: string }>),
        db
          .select({ id: schema.follows.id })
          .from(schema.follows)
          .where(and(eq(schema.follows.followerId, callerId), eq(schema.follows.followingId, userId)))
          .limit(1)
          .catch(() => [] as Array<{ id: string }>),
      ]);
      isFriend = friendRows.length > 0;
      isFollowing = followRows.length > 0;
    }

    // Stats page visibility (PRD §15): only the profile owner or a
    // moderator/admin viewer may open this user's Stats page — and only
    // when the feature_profile_stats flag is on, or the viewer is staff
    // with the flag on the mod-visibility allow-list when it's off.
    const [{ isAdmin: viewerIsAdmin, isModerator: viewerIsModerator }, manifest] = await Promise.all([
      getStaffRoles(callerId),
      loadManifest(),
    ]);
    const statsFeatureAccessible = isFeatureAccessible(
      manifest.features.profileStats,
      manifest.featureModVisibility.includes("profileStats"),
      { isAdmin: viewerIsAdmin, isModerator: viewerIsModerator }
    );
    const canViewStats = statsFeatureAccessible && (isOwnProfile || viewerIsAdmin || viewerIsModerator);

    // 5. Creator card — top rooms + subscriber count (PRD §15)
    let creatorRoom: { id: string; name: string; coverEmoji: string } | null = null;
    let creatorRooms: { id: string; name: string; coverEmoji: string; memberCount: number }[] = [];
    let creatorRoomCount = 0;
    let subscriberCount: number | null = null;
    let totalEarningsKobo: number | null = null;

    if (user.is_creator) {
      const [roomRows, earningsRows] = await Promise.all([
        // total_count comes from the same query/row-set as the top-3 rooms
        // (COUNT(*) OVER()) rather than a second, independently-failing
        // query — so the "see all N rooms" link can never disagree with
        // the rooms actually returned.
        db
          .select({
            id: schema.rooms.id,
            name: schema.rooms.name,
            coverEmoji: schema.rooms.coverEmoji,
            memberCount: schema.rooms.memberCount,
            totalCount: sql<string>`COUNT(*) OVER()`,
          })
          .from(schema.rooms)
          .where(and(eq(schema.rooms.creatorId, userId), eq(schema.rooms.isActive, true)))
          .orderBy(desc(schema.rooms.memberCount))
          .limit(3)
          .catch(() => [] as Array<{ id: string; name: string; coverEmoji: string; memberCount: number; totalCount: string }>),
        db
          .select({
            subscriberCount: sql<string>`COUNT(DISTINCT ${schema.roomMembers.userId})::TEXT`,
            totalEarningsKobo: sql<string>`COALESCE(SUM(${schema.creatorEarnings.grossAmountKobo}), 0)::TEXT`,
          })
          .from(schema.rooms)
          .leftJoin(schema.roomMembers, eq(schema.roomMembers.roomId, schema.rooms.id))
          .leftJoin(schema.creatorEarnings, eq(schema.creatorEarnings.creatorId, userId))
          .where(and(eq(schema.rooms.creatorId, userId), eq(schema.rooms.isActive, true)))
          .catch(() => [] as Array<{ subscriberCount: string; totalEarningsKobo: string }>),
      ]);

      creatorRoom = roomRows[0]
        ? { id: roomRows[0].id, name: roomRows[0].name, coverEmoji: roomRows[0].coverEmoji }
        : null;
      creatorRooms = roomRows.map((r) => ({ id: r.id, name: r.name, coverEmoji: r.coverEmoji, memberCount: r.memberCount }));
      creatorRoomCount = parseInt(roomRows[0]?.totalCount ?? "0", 10);
      subscriberCount = earningsRows[0] ? parseInt(earningsRows[0].subscriberCount, 10) : 0;
      // Only expose total earnings to the profile owner (privacy gate)
      totalEarningsKobo = isOwnProfile && earningsRows[0]
        ? parseInt(earningsRows[0].totalEarningsKobo, 10)
        : null;
    }

    // 5b. Connection badge — check if viewer has an active DM connection badge with this user (PRD §5/§15)
    let connectionBadge: string | null = null;
    if (!isOwnProfile) {
      try {
        const badgeResult = await db.execute(sql`
          SELECT conversation_score AS streak_days,
                  CASE
                    WHEN conversation_score >= 30 THEN 'Platinum Bond'
                    WHEN conversation_score >= 14 THEN 'Gold Connection'
                    WHEN conversation_score >= 7  THEN 'Connected'
                    ELSE NULL
                  END AS tier
           FROM dm_conversations
           WHERE (user_id_1 = LEAST(${callerId}::text,${userId}::text) AND user_id_2 = GREATEST(${callerId}::text,${userId}::text))
             AND conversation_score >= 7
           LIMIT 1
        `);
        const badgeRows = badgeResult.rows as unknown as Array<{ streak_days: number; tier: string | null }>;
        connectionBadge = badgeRows[0]?.tier ?? null;
      } catch {
        // Non-fatal — dm_conversations may not have conversation_score yet
      }
    }

    // 5c. Public Achievements Wall — top lifetime milestones (PRD §15)
    const rawAchievementRows = await db
      .select({
        badgeKey: schema.userBadges.badgeKey,
        badgeType: schema.userBadges.badgeType,
        awardedAt: schema.userBadges.awardedAt,
        metadata: schema.userBadges.metadata,
      })
      .from(schema.userBadges)
      .where(eq(schema.userBadges.userId, userId))
      .orderBy(schema.userBadges.awardedAt)
      .limit(12)
      .catch(() => [] as Array<{ badgeKey: string | null; badgeType: string | null; awardedAt: Date | null; metadata: unknown }>);
    const achievementRows = rawAchievementRows.map((a) => ({
      badge_key: a.badgeKey ?? "",
      badge_type: a.badgeType ?? "",
      awarded_at: a.awardedAt ? a.awardedAt.toISOString() : "",
      metadata: a.metadata as Record<string, unknown> | null,
    }));

    // 6. Past seasons (up to 12 most recent)
    // NOTE: seasons has no `theme_emoji` or `ended_at` column in the current
    // Drizzle schema (lib/db/schema.ts) — this pre-existing query targeted
    // columns that don't exist there, so it always failed and was silently
    // swallowed by .catch() below (pre-existing gap, not introduced here).
    let seasonRows: Array<{ id: string; name: string; theme_emoji: string | null; ended_at: string | null; final_rank: number | null }> = [];
    try {
      const seasonResult = await db.execute(sql`
        SELECT s.id, s.name, s.theme_emoji, s.ended_at, sra.final_rank
        FROM season_rank_archives sra
        JOIN seasons s ON s.id = sra.season_id
        WHERE sra.user_id = ${userId} AND s.ended_at IS NOT NULL
        ORDER BY s.ended_at DESC
        LIMIT 12
      `);
      seasonRows = seasonResult.rows as unknown as Array<{ id: string; name: string; theme_emoji: string | null; ended_at: string | null; final_rank: number | null }>;
    } catch {
      seasonRows = [];
    }

    // 6b. Profile theme (color skin only — see lib/profile/themes.ts).
    // Always shown to any viewer, like a blog's active theme, since it's the
    // owner's chosen visual identity, not privacy-sensitive data.
    const profileThemeRow = await getProfileTheme(user.active_profile_theme_id).catch(() => null);
    const profileTheme = {
      id: profileThemeRow?.id ?? "classic",
      config: profileThemeRow?.config ?? DEFAULT_PROFILE_THEME_TOKENS,
    };

    // 7. Compose rank info
    const rankInfo = getRankForXP(user.xp_total);

    // 8. Build response (apply hidden sections for non-owners)
    const hidden = isOwnProfile ? [] : hiddenSections;

    const rankName = rankInfo.rankName;
    const rankColor = RANK_COLORS[rankName] ?? "#9CA3AF";

    // Progress within the current level (matches the own-profile TrackBar
    // formula: xp % XP_PER_TRACK_LEVEL out of XP_PER_TRACK_LEVEL). Without
    // this, `xp`/`xpForNext` were previously omitted entirely, which made the
    // client's `track.xpForNext > 0` guard always fall through to 100% —
    // every track bar rendered full regardless of actual progress.
    const trackProgress = (trackXp: number) => ({
      xp: trackXp % XP_PER_TRACK_LEVEL,
      xpForNext: XP_PER_TRACK_LEVEL,
    });

    const trackLevels = hidden.includes("xp") ? [] : [
      { track: "Social",     label: "Social",     emoji: TRACK_EMOJIS.social,     level: user.level_social,     maxLevel: TRACK_MAX_LEVEL, ...trackProgress(user.xp_social) },
      { track: "Creator",    label: "Creator",    emoji: TRACK_EMOJIS.creator,    level: user.level_creator,    maxLevel: TRACK_MAX_LEVEL, ...trackProgress(user.xp_creator) },
      { track: "Competitor", label: "Competitor", emoji: TRACK_EMOJIS.competitor, level: user.level_competitor, maxLevel: TRACK_MAX_LEVEL, ...trackProgress(user.xp_competitor) },
      { track: "Generosity", label: "Generosity", emoji: TRACK_EMOJIS.generosity, level: user.level_generosity, maxLevel: TRACK_MAX_LEVEL, ...trackProgress(user.xp_generosity) },
      { track: "Knowledge",  label: "Knowledge",  emoji: TRACK_EMOJIS.knowledge,  level: user.level_knowledge,  maxLevel: TRACK_MAX_LEVEL, ...trackProgress(user.xp_knowledge) },
      { track: "Explorer",   label: "Explorer",   emoji: TRACK_EMOJIS.explorer,   level: user.level_explorer,   maxLevel: TRACK_MAX_LEVEL, ...trackProgress(user.xp_explorer) },
      { track: "Gaming",     label: "Gaming",     emoji: TRACK_EMOJIS.gaming,     level: user.level_gaming,     maxLevel: TRACK_MAX_LEVEL, ...trackProgress(user.xp_gaming) },
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
      loginStreak: hidden.includes("xp") ? null : user.login_streak,
      longestStreak: hidden.includes("xp") ? null : user.longest_streak,
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
      // Profile theme (color skin) — see lib/profile/themes.ts
      profileTheme,
    };

    return NextResponse.json({ profile }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
