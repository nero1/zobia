export const dynamic = 'force-dynamic';

/**
 * Friend relationship management — list and send requests.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { badRequest, notFound } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { XP_VALUES } from '@/lib/xp/engine';
import { insertNotification } from '@/lib/notifications/insert';
import { advanceNewMemberQuestFriendRequestStep } from '@/lib/quests/newMemberQuestEngine';

/** GET /api/friends — list accepted friends */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  const userId = auth.user.sub;
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor');
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 100);

  const { rows } = await db.query(
    `SELECT f.id, f.created_at,
            u.id AS friend_id, u.username, u.display_name, u.avatar_emoji, u.rank_name,
            u.is_creator, u.is_verified, u.plan
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
     WHERE (f.requester_id = $1 OR f.addressee_id = $1)
       AND f.status = 'accepted'
       AND ($2::uuid IS NULL OR f.id < $2::uuid)
     ORDER BY f.created_at DESC
     LIMIT $3`,
    [userId, cursor ?? null, limit + 1],
  );

  const hasNextPage = rows.length > limit;
  const rawData = hasNextPage ? rows.slice(0, limit) : rows;

  // Normalize to camelCase so all clients (web, expo, PWA) get consistent field names
  const friends = rawData.map((r) => ({
    id: r.friend_id,
    userId: r.friend_id,
    username: r.username,
    displayName: r.display_name ?? r.username,
    avatarEmoji: r.avatar_emoji ?? '🙂',
    rankName: r.rank_name ?? null,
    isCreator: r.is_creator ?? false,
    isVerified: r.is_verified ?? false,
    plan: r.plan ?? 'free',
    isOnline: false,
    friendshipId: r.id,
    createdAt: r.created_at,
  }));

  const nextCursor = hasNextPage ? friends[friends.length - 1]?.friendshipId ?? null : null;
  return NextResponse.json({
    friends,
    data: friends,
    nextCursor,
    pagination: { hasNextPage, nextCursor },
  });
});

/** POST /api/friends — send a friend request */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  const userId = auth.user.sub;
  const body = await req.json();
  const targetId: string | undefined = body?.userId;

  if (!targetId) throw badRequest('userId is required');
  if (targetId === userId) throw badRequest('Cannot add yourself');

  const { rows: targetRows } = await db.query('SELECT id FROM users WHERE id = $1', [targetId]);
  if (!targetRows[0]) throw notFound('User not found');

  // Check no existing relationship
  const { rows: existingRows } = await db.query(
    `SELECT id, status FROM friendships
     WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
    [userId, targetId],
  );
  const existing = existingRows[0];
  if (existing) {
    if (existing.status === 'accepted') throw badRequest('Already friends');
    if (existing.status === 'pending') throw badRequest('Request already pending');
    if (existing.status === 'blocked') throw badRequest('Cannot send request');
  }

  await db.query(
    `INSERT INTO friendships (requester_id, addressee_id, status)
     VALUES ($1, $2, 'pending')`,
    [userId, targetId],
  );

  // Notify the addressee of the new incoming friend request — powers the
  // blue "new request" dot on the Friends page Requests tab (unread,
  // type = 'friend_request'). Best-effort: a notification failure must not
  // block the friend request itself.
  insertNotification(
    db,
    targetId,
    'friend_request',
    'New friend request',
    `@${auth.user.username} sent you a friend request`,
    { requesterId: userId, requesterUsername: auth.user.username },
  ).catch(() => {});

  // Award XP for sending a friend request (PRD §6: +10 XP social track)
  const xpAmount = XP_VALUES.add_new_friend;
  await db.query(
    `UPDATE users SET xp_total = xp_total + $1, xp_social = xp_social + $1, updated_at = NOW() WHERE id = $2`,
    [xpAmount, userId],
  ).catch(() => {});
  await db.query(
    `INSERT INTO xp_ledger (user_id, amount, track, source, base_amount, created_at)
     VALUES ($1, $2, 'social', 'add_new_friend', $2, NOW())`,
    [userId, xpAmount],
  ).catch(() => {});

  // Increment friend_request new-member quest step (non-fatal)
  void advanceNewMemberQuestFriendRequestStep(db, userId);

  return NextResponse.json({ success: true }, { status: 201 });
});
