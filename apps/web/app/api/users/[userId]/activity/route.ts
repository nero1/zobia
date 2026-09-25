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
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

    const db = await getDb();
    const [user] = await db
      .select({
        id: schema.users.id,
        isSuspended: schema.users.isSuspended,
        isBanned: schema.users.isBanned,
        profilePrivate: schema.users.profilePrivate,
        profileHiddenSections: schema.users.profileHiddenSections,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!user) throw notFound("User not found");

    if (!isOwnProfile) {
      if (user.isBanned) {
        return NextResponse.json({ error: "This account has been restricted.", code: "ACCOUNT_RESTRICTED" }, { status: 403 });
      }
      if (user.isSuspended) {
        return NextResponse.json({ error: "This account is temporarily suspended.", code: "ACCOUNT_SUSPENDED" }, { status: 403 });
      }
      if (user.profilePrivate) {
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
      const hiddenSections: string[] = Array.isArray(user.profileHiddenSections) ? (user.profileHiddenSections as string[]) : [];
      if (hiddenSections.includes("activities")) {
        return NextResponse.json({ error: "This user's activity is not visible.", code: "ACTIVITIES_HIDDEN" }, { status: 403 });
      }
    }

    const [rankUps, badges, guildJoins] = await Promise.all([
      db
        .select({ rankTo: schema.rankUpEvents.rankTo, createdAt: schema.rankUpEvents.createdAt })
        .from(schema.rankUpEvents)
        .where(eq(schema.rankUpEvents.userId, userId))
        .orderBy(desc(schema.rankUpEvents.createdAt))
        .limit(limit)
        .catch(() => [] as Array<{ rankTo: string; createdAt: Date | null }>),
      db
        .select({ badgeKey: schema.userBadges.badgeKey, awardedAt: schema.userBadges.awardedAt, metadata: schema.userBadges.metadata })
        .from(schema.userBadges)
        .where(eq(schema.userBadges.userId, userId))
        .orderBy(desc(schema.userBadges.awardedAt))
        .limit(limit)
        .catch(() => [] as Array<{ badgeKey: string | null; awardedAt: Date | null; metadata: unknown }>),
      db
        .select({ guildName: schema.guilds.name, joinedAt: schema.guildMembers.joinedAt })
        .from(schema.guildMembers)
        .innerJoin(schema.guilds, eq(schema.guilds.id, schema.guildMembers.guildId))
        .where(eq(schema.guildMembers.userId, userId))
        .orderBy(desc(schema.guildMembers.joinedAt))
        .limit(limit)
        .catch(() => [] as Array<{ guildName: string; joinedAt: Date | null }>),
    ]);

    const items: ActivityItem[] = [
      ...rankUps.map((r) => ({
        type: "rank_up" as const,
        emoji: "🏅",
        label: `Ranked up to ${r.rankTo}`,
        occurredAt: r.createdAt ? r.createdAt.toISOString() : "",
      })),
      ...badges.map((b) => ({
        type: "badge" as const,
        emoji: "🏆",
        label: `Unlocked ${(b.metadata as Record<string, string> | null)?.title ?? (b.badgeKey ?? "").replace(/_/g, " ")}`,
        occurredAt: b.awardedAt ? b.awardedAt.toISOString() : "",
      })),
      ...guildJoins.map((g) => ({
        type: "guild_join" as const,
        emoji: "🛡️",
        label: `Joined guild ${g.guildName}`,
        occurredAt: g.joinedAt ? g.joinedAt.toISOString() : "",
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
