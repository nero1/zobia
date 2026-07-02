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
 * /admin/settings/profile-stats.
 *
 * Gated by the `feature_profile_stats` master switch (Admin > Feature Flags).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { isFeatureEnabled } from "@/lib/manifest";
import { getAllowedPlans, isPlanEligible } from "@/lib/plans/eligibility";
import { isAdminOrModerator } from "@/lib/auth/roles";
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
  { track: "social",      label: "Social",     emoji: "💬", xpKey: "xp_social",     levelKey: "level_social" },
  { track: "creator",     label: "Creator",    emoji: "🎨", xpKey: "xp_creator",    levelKey: "level_creator" },
  { track: "competitor",  label: "Competitor", emoji: "⚔️", xpKey: "xp_competitor", levelKey: "level_competitor" },
  { track: "generosity",  label: "Generosity", emoji: "🎁", xpKey: "xp_generosity", levelKey: "level_generosity" },
  { track: "gaming",      label: "Gaming",     emoji: "🎮", xpKey: "xp_gaming",     levelKey: "level_gaming" },
  { track: "knowledge",   label: "Knowledge",  emoji: "📚", xpKey: "xp_knowledge",  levelKey: "level_knowledge" },
  { track: "explorer",    label: "Explorer",   emoji: "🧭", xpKey: "xp_explorer",   levelKey: "level_explorer" },
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

    if (!(await isFeatureEnabled("feature_profile_stats"))) {
      const err = new Error("The Stats page is currently unavailable.") as Error & { code: string; statusCode: number };
      err.code = "FEATURE_DISABLED";
      err.statusCode = 503;
      throw err;
    }

    const callerId = auth.user.sub;
    const isOwnStats = callerId === userId;

    // Only the owner or a moderator/admin may view a user's stats.
    if (!isOwnStats && !(await isAdminOrModerator(callerId))) {
      throw forbidden("You do not have permission to view this user's stats.");
    }

    const { rows: userRows } = await db.query<{
      id: string;
      username: string | null;
      display_name: string | null;
      avatar_emoji: string | null;
      city: string | null;
      plan: string;
      prestige_count: number;
      xp_total: number;
      legacy_score: number;
      is_creator: boolean;
      created_at: string;
      guild_id: string | null;
      xp_social: number; xp_creator: number; xp_competitor: number; xp_generosity: number;
      xp_gaming: number; xp_knowledge: number; xp_explorer: number;
      level_social: number; level_creator: number; level_competitor: number; level_generosity: number;
      level_gaming: number; level_knowledge: number; level_explorer: number;
    }>(
      `SELECT id, username, display_name, avatar_emoji, city,
              COALESCE(plan, 'free') AS plan,
              COALESCE(prestige_count, 0) AS prestige_count,
              xp_total, COALESCE(legacy_score, 0) AS legacy_score,
              COALESCE(is_creator, false) AS is_creator,
              created_at, guild_id,
              xp_social, xp_creator, xp_competitor, xp_generosity, xp_gaming, xp_knowledge, xp_explorer,
              level_social, level_creator, level_competitor, level_generosity, level_gaming, level_knowledge, level_explorer
       FROM users
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [userId]
    );
    const user = userRows[0];
    if (!user) throw notFound("User not found");

    const fullPlans = await getAllowedPlans("profile_stats_full_plans", ["plus", "pro", "max"]);
    const tier: "basic" | "full" = isPlanEligible(user.plan, user.prestige_count, fullPlans) ? "full" : "basic";

    const rankInfo = getRankForXP(user.xp_total);

    const [
      badgeRows,
      guildRow,
      friendsCountRow,
      followersCountRow,
      followingCountRow,
      referralsRow,
      roomsRows,
    ] = await Promise.all([
      db.query<{ badge_key: string; badge_type: string; awarded_at: string; metadata: Record<string, unknown> | null }>(
        `SELECT badge_key, badge_type, awarded_at, metadata FROM user_badges WHERE user_id = $1 ORDER BY awarded_at DESC LIMIT 100`,
        [userId]
      ).catch(() => ({ rows: [] as Array<{ badge_key: string; badge_type: string; awarded_at: string; metadata: Record<string, unknown> | null }> })),
      user.guild_id
        ? db.query<{ name: string; crest_emoji: string | null; tier: string }>(
            `SELECT name, crest_emoji, tier FROM guilds WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
            [user.guild_id]
          ).catch(() => ({ rows: [] as Array<{ name: string; crest_emoji: string | null; tier: string }> }))
        : Promise.resolve({ rows: [] as Array<{ name: string; crest_emoji: string | null; tier: string }> }),
      db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM friendships WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'`,
        [userId]
      ),
      db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM follows WHERE following_id = $1`, [userId]),
      db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM follows WHERE follower_id = $1`, [userId]),
      db.query<{ total: string; qualified: string }>(
        `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE qualified) AS qualified FROM referrals WHERE referrer_id = $1`,
        [userId]
      ).catch(() => ({ rows: [{ total: "0", qualified: "0" }] })),
      user.is_creator
        ? db.query<{ id: string; name: string; cover_emoji: string; member_count: number }>(
            `SELECT id, name, cover_emoji, member_count FROM rooms
             WHERE creator_id = $1 AND is_active = TRUE
             ORDER BY member_count DESC LIMIT 50`,
            [userId]
          ).catch(() => ({ rows: [] as Array<{ id: string; name: string; cover_emoji: string; member_count: number }> }))
        : Promise.resolve({ rows: [] as Array<{ id: string; name: string; cover_emoji: string; member_count: number }> }),
    ]);

    // Leaderboard positions — basic tier gets only the main global rank;
    // full tier gets every track across every scope the user belongs to.
    let leaderboard: Array<{ track: string; globalRank: number | null; cityRank: number | null; guildRank: number | null; seasonRank: number | null }>;
    let seasonHistory: Array<{ id: string; name: string; themeEmoji: string; year: number; finalRank: number | null }> = [];

    if (tier === "full") {
      const seasonRow = await db.query<{ id: string }>(
        `SELECT id FROM seasons WHERE is_active = TRUE AND ends_at > NOW() LIMIT 1`
      );
      const seasonId = seasonRow.rows[0]?.id ?? null;

      leaderboard = await Promise.all(
        ALL_TRACKS.map(async (track) => {
          const [globalRank, cityRank, guildRank, seasonRank] = await Promise.all([
            getUserRank(userId, track, "global", db),
            user.city ? getUserRank(userId, track, "city", db, { city: user.city }) : Promise.resolve(null),
            user.guild_id ? getUserRank(userId, track, "guild", db, { guildId: user.guild_id }) : Promise.resolve(null),
            seasonId ? getUserRank(userId, track, "season", db, { seasonId }) : Promise.resolve(null),
          ]);
          return { track, globalRank, cityRank, guildRank, seasonRank };
        })
      );

      const { rows: seasonRows } = await db.query<{
        id: string; name: string; theme_emoji: string | null; ended_at: string | null; final_rank: number | null;
      }>(
        `SELECT s.id, s.name, s.theme_emoji, s.ended_at, sra.final_rank
         FROM season_rank_archives sra
         JOIN seasons s ON s.id = sra.season_id
         WHERE sra.user_id = $1 AND s.ended_at IS NOT NULL
         ORDER BY s.ended_at DESC LIMIT 24`,
        [userId]
      ).catch(() => ({ rows: [] as Array<{ id: string; name: string; theme_emoji: string | null; ended_at: string | null; final_rank: number | null }> }));

      seasonHistory = seasonRows.map((s) => ({
        id: s.id,
        name: s.name,
        themeEmoji: s.theme_emoji ?? "🏆",
        year: s.ended_at ? new Date(s.ended_at).getFullYear() : new Date().getFullYear(),
        finalRank: s.final_rank ?? null,
      }));
    } else {
      const globalRank = await getUserRank(userId, "main", "global", db);
      leaderboard = [{ track: "main", globalRank, cityRank: null, guildRank: null, seasonRank: null }];
    }

    const tracks = TRACK_META.map((t) => ({
      track: t.track,
      label: t.label,
      emoji: t.emoji,
      xp: (user as unknown as Record<string, number>)[t.xpKey] ?? 0,
      level: (user as unknown as Record<string, number>)[t.levelKey] ?? 1,
    }));

    const guild = guildRow.rows[0]
      ? { id: user.guild_id, name: guildRow.rows[0].name, crestEmoji: guildRow.rows[0].crest_emoji ?? "🛡️", tier: guildRow.rows[0].tier }
      : null;

    return NextResponse.json({
      tier,
      isOwnStats,
      profile: {
        id: user.id,
        username: user.username,
        displayName: user.display_name ?? user.username ?? "Zobia User",
        avatarEmoji: user.avatar_emoji ?? "😊",
        city: user.city,
        joinedAt: user.created_at,
        plan: user.plan,
        isCreator: user.is_creator,
        rankName: rankInfo.rankName,
        rankSublevel: rankInfo.sublevel,
        xpTotal: user.xp_total,
        xpForNextRank: rankInfo.nextRankXp ?? 0,
        legacyScore: user.legacy_score,
        prestigeCount: user.prestige_count,
      },
      tracks,
      badges: badgeRows.rows.map((b) => ({
        key: b.badge_key,
        type: b.badge_type,
        grantedAt: b.awarded_at,
        label: (b.metadata as Record<string, string> | null)?.title ?? b.badge_key.replace(/_/g, " "),
      })),
      guild,
      social: {
        friendsCount: parseInt(friendsCountRow.rows[0]?.count ?? "0", 10),
        followersCount: parseInt(followersCountRow.rows[0]?.count ?? "0", 10),
        followingCount: parseInt(followingCountRow.rows[0]?.count ?? "0", 10),
        referralsCount: parseInt(referralsRow.rows[0]?.total ?? "0", 10),
        qualifiedReferralsCount: parseInt(referralsRow.rows[0]?.qualified ?? "0", 10),
      },
      createdRooms: roomsRows.rows.map((r) => ({ id: r.id, name: r.name, coverEmoji: r.cover_emoji, memberCount: r.member_count })),
      leaderboard,
      seasonHistory,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
