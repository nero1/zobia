export const dynamic = 'force-dynamic';

/**
 * app/api/users/[userId]/stats/route.ts
 *
 * GET /api/users/[userId]/stats
 *
 * User Profile Stats page (PRD §15) — a single endpoint aggregating badges,
 * levels/tracks, achievements, created rooms, leaderboard positions, and
 * social counts (friends/followers/following/referrals) for one user.
 *
 * Visibility: only the profile owner or a moderator/admin may view it.
 * Depth: gated by plan/prestige via `profile_stats_full_plans` (x_manifest) —
 * eligible plans get the "full" view (all leaderboard scopes + season
 * history); everyone else gets the "basic" view. Free users get basic by
 * default; the admin can reconfigure the eligible plan list at
 * /gate44/settings/profile-stats.
 *
 * Gated by the `feature_profile_stats` master switch (Admin > Feature Flags).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, count, countDistinct, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";
import { isFeatureAccessible } from "@/lib/manifest/featureAccess";
import { getAllowedPlans, isPlanEligible, allEligibilityOptionsExcept } from "@/lib/plans/eligibility";
import { getStaffRoles } from "@/lib/auth/roles";
import { getRankForXP } from "@/lib/xp/engine";
import { getUserRank, type LeaderboardTrack } from "@/lib/leaderboards/engine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALL_TRACKS: LeaderboardTrack[] = [
  "main",
  "social",
  "creator",
  "competitor",
  "generosity",
  "knowledge",
  "explorer",
  "gaming",
];

const TRACK_META: Array<{ track: LeaderboardTrack; label: string; emoji: string; xpKey: string; levelKey: string }> = [
  { track: "social",      label: "Social",     emoji: "💬", xpKey: "xpSocial",     levelKey: "levelSocial" },
  { track: "creator",     label: "Creator",    emoji: "🎨", xpKey: "xpCreator",    levelKey: "levelCreator" },
  { track: "competitor",  label: "Competitor", emoji: "⚔️", xpKey: "xpCompetitor", levelKey: "levelCompetitor" },
  { track: "generosity",  label: "Generosity", emoji: "🎁", xpKey: "xpGenerosity", levelKey: "levelGenerosity" },
  { track: "gaming",      label: "Gaming",     emoji: "🎮", xpKey: "xpGaming",     levelKey: "levelGaming" },
  { track: "knowledge",   label: "Knowledge",  emoji: "📚", xpKey: "xpKnowledge",  levelKey: "levelKnowledge" },
  { track: "explorer",    label: "Explorer",   emoji: "🧭", xpKey: "xpExplorer",   levelKey: "levelExplorer" },
];

// ---------------------------------------------------------------------------
// Route params
// ---------------------------------------------------------------------------

interface UserParams {
  userId: string;
}

// ---------------------------------------------------------------------------
// GET /api/users/[userId]/stats
// ---------------------------------------------------------------------------

export const GET = withAuth<UserParams>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { userId } = params;
    if (!UUID_RE.test(userId)) throw badRequest("userId must be a valid UUID");

    const callerId = auth.user.sub;
    const [manifest, callerRoles] = await Promise.all([loadManifest(), getStaffRoles(callerId)]);
    const statsFeatureAccessible = isFeatureAccessible(
      manifest.features.profileStats,
      manifest.featureModVisibility.includes("profileStats"),
      callerRoles
    );
    if (!statsFeatureAccessible) {
      const err = new Error("The Stats page is currently unavailable.") as Error & { code: string; statusCode: number };
      err.code = "FEATURE_DISABLED";
      err.statusCode = 503;
      throw err;
    }

    const isOwnStats = callerId === userId;

    // Only the owner or a moderator/admin may view a user's stats.
    if (!isOwnStats && !(callerRoles.isAdmin || callerRoles.isModerator)) {
      throw forbidden("You do not have permission to view this user's stats.");
    }

    const orm = await getDb();

    const [userRow] = await orm
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarEmoji: schema.users.avatarEmoji,
        city: schema.users.city,
        plan: schema.users.plan,
        prestigeCount: schema.users.prestigeCount,
        isAdmin: schema.users.isAdmin,
        isModerator: schema.users.isModerator,
        businessTier: schema.businessAccounts.tier,
        xpTotal: schema.users.xpTotal,
        legacyScore: schema.users.legacyScore,
        isCreator: schema.users.isCreator,
        createdAt: schema.users.createdAt,
        guildId: schema.users.guildId,
        xpSocial: schema.users.xpSocial,
        xpCreator: schema.users.xpCreator,
        xpCompetitor: schema.users.xpCompetitor,
        xpGenerosity: schema.users.xpGenerosity,
        xpGaming: schema.users.xpGaming,
        xpKnowledge: schema.users.xpKnowledge,
        xpExplorer: schema.users.xpExplorer,
        levelSocial: schema.users.levelSocial,
        levelCreator: schema.users.levelCreator,
        levelCompetitor: schema.users.levelCompetitor,
        levelGenerosity: schema.users.levelGenerosity,
        levelGaming: schema.users.levelGaming,
        levelKnowledge: schema.users.levelKnowledge,
        levelExplorer: schema.users.levelExplorer,
      })
      .from(schema.users)
      .leftJoin(
        schema.businessAccounts,
        and(eq(schema.businessAccounts.userId, schema.users.id), eq(schema.businessAccounts.status, "active"))
      )
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    const user = userRow;
    if (!user) throw notFound("User not found");

    const fullPlans = await getAllowedPlans("profile_stats_full_plans", allEligibilityOptionsExcept(["free"]));
    const tier: "basic" | "full" = isPlanEligible(user.plan, user.prestigeCount, fullPlans, {
      businessTier: user.businessTier,
      isAdmin: user.isAdmin,
      isModerator: user.isModerator,
    }) ? "full" : "basic";

    const rankInfo = getRankForXP(Number(user.xpTotal));

    const [
      badgeRows,
      guildRow,
      friendsCountRow,
      followersCountRow,
      followingCountRow,
      referralsRow,
      roomsRows,
    ] = await Promise.all([
      orm
        .select({
          badge_key: schema.userBadges.badgeKey,
          badge_type: schema.userBadges.badgeType,
          awarded_at: schema.userBadges.awardedAt,
          metadata: schema.userBadges.metadata,
        })
        .from(schema.userBadges)
        .where(eq(schema.userBadges.userId, userId))
        .orderBy(desc(schema.userBadges.awardedAt))
        .limit(100)
        .then((rows) => ({ rows }))
        .catch(() => ({ rows: [] as Array<{ badge_key: string | null; badge_type: string; awarded_at: Date | null; metadata: unknown }> })),
      user.guildId
        ? orm
            .select({ name: schema.guilds.name, crest_emoji: schema.guilds.crestEmoji, tier: schema.guilds.tier })
            .from(schema.guilds)
            .where(and(eq(schema.guilds.id, user.guildId), isNull(schema.guilds.deletedAt)))
            .limit(1)
            .then((rows) => ({ rows }))
            .catch(() => ({ rows: [] as Array<{ name: string; crest_emoji: string | null; tier: string }> }))
        : Promise.resolve({ rows: [] as Array<{ name: string; crest_emoji: string | null; tier: string }> }),
      orm
        .select({ count: count() })
        .from(schema.friendships)
        .where(
          and(
            or(eq(schema.friendships.requesterId, userId), eq(schema.friendships.addresseeId, userId)),
            eq(schema.friendships.status, "accepted")
          )
        ),
      orm.select({ count: count() }).from(schema.follows).where(eq(schema.follows.followingId, userId)),
      orm.select({ count: count() }).from(schema.follows).where(eq(schema.follows.followerId, userId)),
      orm
        .select({
          total: count(),
          qualified: sql<number>`COUNT(*) FILTER (WHERE ${schema.referrals.qualified})`,
        })
        .from(schema.referrals)
        .where(eq(schema.referrals.referrerId, userId))
        .catch(() => [{ total: 0, qualified: 0 }]),
      user.isCreator
        ? orm
            .select({
              id: schema.rooms.id,
              name: schema.rooms.name,
              cover_emoji: schema.rooms.coverEmoji,
              member_count: schema.rooms.memberCount,
            })
            .from(schema.rooms)
            .where(and(eq(schema.rooms.creatorId, userId), eq(schema.rooms.isActive, true)))
            .orderBy(desc(schema.rooms.memberCount))
            .limit(50)
            .then((rows) => ({ rows }))
            .catch(() => ({ rows: [] as Array<{ id: string; name: string; cover_emoji: string; member_count: number }> }))
        : Promise.resolve({ rows: [] as Array<{ id: string; name: string; cover_emoji: string; member_count: number }> }),
    ]);

    // Leaderboard positions — basic tier gets only the main global rank;
    // full tier gets every track across every scope the user belongs to.
    let leaderboard: Array<{ track: string; globalRank: number | null; cityRank: number | null; guildRank: number | null; seasonRank: number | null }>;
    let seasonHistory: Array<{ id: string; name: string; themeEmoji: string; year: number; finalRank: number | null }> = [];

    if (tier === "full") {
      const [seasonRow] = await orm
        .select({ id: schema.seasons.id })
        .from(schema.seasons)
        .where(and(eq(schema.seasons.isActive, true), gt(schema.seasons.endsAt, sql`NOW()`)))
        .limit(1);
      const seasonId = seasonRow?.id ?? null;

      leaderboard = await Promise.all(
        ALL_TRACKS.map(async (track) => {
          const [globalRank, cityRank, guildRank, seasonRank] = await Promise.all([
            getUserRank(userId, track, "global", orm),
            user.city ? getUserRank(userId, track, "city", orm, { city: user.city }) : Promise.resolve(null),
            user.guildId ? getUserRank(userId, track, "guild", orm, { guildId: user.guildId }) : Promise.resolve(null),
            seasonId ? getUserRank(userId, track, "season", orm, { seasonId }) : Promise.resolve(null),
          ]);
          return { track, globalRank, cityRank, guildRank, seasonRank };
        })
      );

      // NOTE (schema gap): this joins on `seasons.theme_emoji` and
      // `seasons.ended_at`, neither of which exists on the Drizzle `seasons`
      // schema (it has `theme` and `startsAt`/`endsAt` instead). The original
      // raw-SQL version referenced the same non-existent columns and relied
      // on the surrounding `.catch()` to swallow the resulting DB error,
      // always yielding an empty `seasonHistory`. Preserved verbatim via a
      // raw `sql` escape rather than silently "fixing" behavior that may be
      // depended on elsewhere — flagging as a real schema gap to resolve
      // separately.
      const seasonRows = await orm
        .execute<{ id: string; name: string; theme_emoji: string | null; ended_at: string | null; final_rank: number | null }>(
          sql`SELECT s.id, s.name, s.theme_emoji, s.ended_at, sra.final_rank
              FROM season_rank_archives sra
              JOIN seasons s ON s.id = sra.season_id
              WHERE sra.user_id = ${userId} AND s.ended_at IS NOT NULL
              ORDER BY s.ended_at DESC LIMIT 24`
        )
        .then((r) => r.rows)
        .catch(() => [] as Array<{ id: string; name: string; theme_emoji: string | null; ended_at: string | null; final_rank: number | null }>);

      seasonHistory = seasonRows.map((s) => ({
        id: s.id,
        name: s.name,
        themeEmoji: s.theme_emoji ?? "🏆",
        year: s.ended_at ? new Date(s.ended_at).getFullYear() : new Date().getFullYear(),
        finalRank: s.final_rank ?? null,
      }));
    } else {
      const globalRank = await getUserRank(userId, "main", "global", orm);
      leaderboard = [{ track: "main", globalRank, cityRank: null, guildRank: null, seasonRank: null }];
    }

    const tracks = TRACK_META.map((t) => ({
      track: t.track,
      label: t.label,
      emoji: t.emoji,
      xp: Number((user as unknown as Record<string, bigint>)[t.xpKey] ?? 0),
      level: (user as unknown as Record<string, number>)[t.levelKey] ?? 1,
    }));

    const guild = guildRow.rows[0]
      ? { id: user.guildId, name: guildRow.rows[0].name, crestEmoji: guildRow.rows[0].crest_emoji ?? "🛡️", tier: guildRow.rows[0].tier }
      : null;

    return NextResponse.json({
      tier,
      isOwnStats,
      profile: {
        id: user.id,
        username: user.username,
        displayName: user.displayName ?? user.username ?? "Zobia User",
        avatarEmoji: user.avatarEmoji ?? "😊",
        city: user.city,
        joinedAt: user.createdAt,
        plan: user.plan,
        isCreator: user.isCreator,
        rankName: rankInfo.rankName,
        rankSublevel: rankInfo.sublevel,
        xpTotal: Number(user.xpTotal),
        xpForNextRank: rankInfo.nextRankXp ?? 0,
        legacyScore: Number(user.legacyScore),
        prestigeCount: user.prestigeCount,
      },
      tracks,
      badges: badgeRows.rows.map((b) => ({
        key: b.badge_key,
        type: b.badge_type,
        grantedAt: b.awarded_at,
        label: (b.metadata as Record<string, string> | null)?.title ?? (b.badge_key ?? "").replace(/_/g, " "),
      })),
      guild,
      social: {
        friendsCount: friendsCountRow[0]?.count ?? 0,
        followersCount: followersCountRow[0]?.count ?? 0,
        followingCount: followingCountRow[0]?.count ?? 0,
        referralsCount: Number(referralsRow[0]?.total ?? 0),
        qualifiedReferralsCount: Number(referralsRow[0]?.qualified ?? 0),
      },
      createdRooms: roomsRows.rows.map((r) => ({ id: r.id, name: r.name, coverEmoji: r.cover_emoji, memberCount: r.member_count })),
      leaderboard,
      seasonHistory,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
