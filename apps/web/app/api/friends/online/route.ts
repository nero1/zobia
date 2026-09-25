export const dynamic = 'force-dynamic';

/**
 * app/api/friends/online/route.ts
 *
 * GET /api/friends/online — friends who are online or recently active, for
 * the Home page "Online Friends" row.
 *
 * Fixes a bug where the Home page listed *every* accepted friend regardless
 * of presence (via GET /api/friends), so offline friends always showed up.
 * This endpoint filters to friends who:
 *  1. Opted in to `show_online_status` (Pro/Max privacy toggle — see
 *     /api/users/me/privacy) — friends who haven't opted in never appear here.
 *  2. Have `last_active_at` within the last hour ("recently active"; within
 *     5 minutes is surfaced as "online"). This reuses the `last_active_at`
 *     column already kept warm by the presence heartbeat
 *     (POST /api/presence) instead of adding a Redis lookup per friend —
 *     a single SQL filter, zero extra Redis calls.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/drizzle';

const ONLINE_WINDOW_MINUTES = 5;
const RECENTLY_ACTIVE_WINDOW_MINUTES = 60;

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  const userId = auth.user.sub;
  const { searchParams } = new URL(req.url);
  const rawLimit = Number(searchParams.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;

  const orm = await getDb();
  const friendUserId = sql<string>`CASE WHEN ${schema.friendships.requesterId} = ${userId} THEN ${schema.friendships.addresseeId} ELSE ${schema.friendships.requesterId} END`;
  const isOnline = sql<boolean>`(${schema.users.lastActiveAt} > NOW() - INTERVAL '${sql.raw(String(ONLINE_WINDOW_MINUTES))} minutes')`;
  const rows = await orm
    .select({
      friend_id: schema.users.id,
      username: schema.users.username,
      display_name: schema.users.displayName,
      avatar_emoji: schema.users.avatarEmoji,
      rank_name: schema.users.rankName,
      is_creator: schema.users.isCreator,
      is_verified: schema.users.isVerified,
      plan: schema.users.plan,
      last_active_at: schema.users.lastActiveAt,
      is_online: isOnline,
    })
    .from(schema.friendships)
    .innerJoin(schema.users, eq(schema.users.id, friendUserId))
    .where(
      and(
        or(eq(schema.friendships.requesterId, userId), eq(schema.friendships.addresseeId, userId)),
        eq(schema.friendships.status, 'accepted'),
        eq(schema.users.showOnlineStatus, true),
        gt(schema.users.lastActiveAt, sql`NOW() - INTERVAL '${sql.raw(String(RECENTLY_ACTIVE_WINDOW_MINUTES))} minutes'`),
        isNull(schema.users.deletedAt),
      ),
    )
    .orderBy(desc(schema.users.lastActiveAt))
    .limit(limit);

  const friends = rows.map((r) => ({
    id: r.friend_id,
    userId: r.friend_id,
    username: r.username,
    displayName: r.display_name ?? r.username,
    avatarEmoji: r.avatar_emoji ?? '🙂',
    rankName: r.rank_name ?? null,
    isCreator: r.is_creator ?? false,
    isVerified: r.is_verified ?? false,
    plan: r.plan ?? 'free',
    isOnline: Boolean(r.is_online),
  }));

  return NextResponse.json({ success: true, data: friends, friends });
});
