export const dynamic = 'force-dynamic';

/**
 * app/api/users/[userId]/activity/route.ts
 *
 * GET /api/users/[userId]/activity
 *
 * Read-only "Activities" feed for the profile page's Moments | Activities
 * tabs (app/(app)/profile/[userId]/page.tsx). Built entirely from tables
 * that already exist — rank_up_events, user_badges, guild_members — with a
 * single UNION ALL query per source, LIMITed and merged in JS. No new
 * logging pipeline, no new Redis usage (this product is on a Redis free
 * tier); plain indexed Postgres queries only.
 *
 * Privacy: mirrors the checks in app/api/users/[userId]/profile/route.ts —
 * banned/suspended accounts, private profiles (friends-only), and the
 * generic profile_hidden_sections mechanism ("activities" is one of the
 * admin-configurable hideable sections, see privacy_hideable_sections in
 * x_manifest). When a non-owner viewer is blocked, the endpoint returns
 * 403 ACTIVITIES_HIDDEN rather than an empty 200 — the client must not be
 * able to distinguish "no activity" from "hidden" by shape alone, but more
 * importantly no activity rows are ever included in the response body.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { logger } from "@/lib/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UserParams {
  userId: string;
}

interface ActivityItem {
  type: "rank_up" | "badge" | "guild_join";
  emoji: string;
  label: string;
  occurredAt: string;
}

export const GET = withAuth<UserParams>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { userId } = params;
    if (!UUID_RE.test(userId)) throw badRequest("userId must be a valid UUID");

    const callerId = auth.user.sub;
    const isOwnProfile = callerId === userId;
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "30", 10), 50);

    const { rows: userRows } = await db.query<{
      id: string;
      is_suspended: boolean;
      is_banned: boolean;
      profile_private: boolean;
      profile_hidden_sections: string[];
    }>(
      `SELECT id, COALESCE(is_suspended, false) AS is_suspended, COALESCE(is_banned, false) AS is_banned,
              COALESCE(profile_private, false) AS profile_private,
              COALESCE(profile_hidden_sections, '[]'::jsonb) AS profile_hidden_sections
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    const user = userRows[0];
    if (!user) throw notFound("User not found");

    if (!isOwnProfile) {
      if (user.is_banned) {
        return NextResponse.json({ error: "This account has been restricted.", code: "ACCOUNT_RESTRICTED" }, { status: 403 });
      }
      if (user.is_suspended) {
        return NextResponse.json({ error: "This account is temporarily suspended.", code: "ACCOUNT_SUSPENDED" }, { status: 403 });
      }
      if (user.profile_private) {
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
      const hiddenSections: string[] = Array.isArray(user.profile_hidden_sections) ? user.profile_hidden_sections : [];
      if (hiddenSections.includes("activities")) {
        return NextResponse.json({ error: "This user's activity is not visible.", code: "ACTIVITIES_HIDDEN" }, { status: 403 });
      }
    }

    const [rankUps, badges, guildJoins] = await Promise.all([
      db.query<{ rank_to: string; created_at: string }>(
        `SELECT rank_to, created_at FROM rank_up_events
         WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [userId, limit]
      ).catch(() => ({ rows: [] as Array<{ rank_to: string; created_at: string }> })),
      db.query<{ badge_key: string; awarded_at: string; metadata: Record<string, unknown> | null }>(
        `SELECT badge_key, awarded_at, metadata FROM user_badges
         WHERE user_id = $1 ORDER BY awarded_at DESC LIMIT $2`,
        [userId, limit]
      ).catch(() => ({ rows: [] as Array<{ badge_key: string; awarded_at: string; metadata: Record<string, unknown> | null }> })),
      db.query<{ guild_name: string; joined_at: string }>(
        `SELECT g.name AS guild_name, gm.joined_at
         FROM guild_members gm
         JOIN guilds g ON g.id = gm.guild_id
         WHERE gm.user_id = $1 ORDER BY gm.joined_at DESC LIMIT $2`,
        [userId, limit]
      ).catch(() => ({ rows: [] as Array<{ guild_name: string; joined_at: string }> })),
    ]);

    const items: ActivityItem[] = [
      ...rankUps.rows.map((r) => ({
        type: "rank_up" as const,
        emoji: "🏅",
        label: `Ranked up to ${r.rank_to}`,
        occurredAt: r.created_at,
      })),
      ...badges.rows.map((b) => ({
        type: "badge" as const,
        emoji: "🏆",
        label: `Unlocked ${(b.metadata as Record<string, string> | null)?.title ?? b.badge_key.replace(/_/g, " ")}`,
        occurredAt: b.awarded_at,
      })),
      ...guildJoins.rows.map((g) => ({
        type: "guild_join" as const,
        emoji: "🛡️",
        label: `Joined guild ${g.guild_name}`,
        occurredAt: g.joined_at,
      })),
    ]
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
      .slice(0, limit);

    return NextResponse.json({ activities: items }, { status: 200 });
  } catch (err) {
    logger.error({ err }, "GET /api/users/[userId]/activity failed");
    return handleApiError(err);
  }
});
