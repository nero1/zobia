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
import { db } from '@/lib/db';

const ONLINE_WINDOW_MINUTES = 5;
const RECENTLY_ACTIVE_WINDOW_MINUTES = 60;

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  const userId = auth.user.sub;
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get('limit') ?? 20), 50);

  const { rows } = await db.query(
    `SELECT u.id AS friend_id, u.username, u.display_name, u.avatar_emoji, u.rank_name,
            u.is_creator, u.is_verified, u.plan, u.last_active_at,
            (u.last_active_at > NOW() - INTERVAL '${ONLINE_WINDOW_MINUTES} minutes') AS is_online
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
     WHERE (f.requester_id = $1 OR f.addressee_id = $1)
       AND f.status = 'accepted'
       AND u.show_online_status = TRUE
       AND u.last_active_at > NOW() - INTERVAL '${RECENTLY_ACTIVE_WINDOW_MINUTES} minutes'
       AND u.deleted_at IS NULL
     ORDER BY u.last_active_at DESC
     LIMIT $2`,
    [userId, limit],
  );

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
