export const dynamic = 'force-dynamic';

/**
 * Friend relationship management — list and send requests.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { badRequest, notFound } from '@/lib/api/errors';
import { and, eq, desc, lt, or, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/drizzle';
import { XP_VALUES } from '@/lib/xp/engine';
import { insertNotification } from '@/lib/notifications/insert';
import { advanceNewMemberQuestFriendRequestStep } from '@/lib/quests/newMemberQuestEngine';

/** GET /api/friends — list accepted friends */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  const userId = auth.user.sub;
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor');
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 100);

  const orm = await getDb();
  const friendUserId = sql<string>`CASE WHEN ${schema.friendships.requesterId} = ${userId} THEN ${schema.friendships.addresseeId} ELSE ${schema.friendships.requesterId} END`;
  const rows = await orm
    .select({
      id: schema.friendships.id,
      created_at: schema.friendships.createdAt,
      friend_id: schema.users.id,
      username: schema.users.username,
      display_name: schema.users.displayName,
      avatar_emoji: schema.users.avatarEmoji,
      avatar_url: schema.users.avatarUrl,
      rank_name: schema.users.rankName,
      is_creator: schema.users.isCreator,
      is_verified: schema.users.isVerified,
      plan: schema.users.plan,
    })
    .from(schema.friendships)
    .innerJoin(schema.users, eq(schema.users.id, friendUserId))
    .where(
      and(
        or(eq(schema.friendships.requesterId, userId), eq(schema.friendships.addresseeId, userId)),
        eq(schema.friendships.status, 'accepted'),
        cursor ? lt(schema.friendships.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(schema.friendships.createdAt))
    .limit(limit + 1);

  const hasNextPage = rows.length > limit;
  const rawData = hasNextPage ? rows.slice(0, limit) : rows;

  // Normalize to camelCase so all clients (web, expo, PWA) get consistent field names
  const friends = rawData.map((r) => ({
    id: r.friend_id,
    userId: r.friend_id,
    username: r.username,
    displayName: r.display_name ?? r.username,
    avatarEmoji: r.avatar_emoji ?? '🙂',
    avatarUrl: r.avatar_url ?? null,
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

  const orm = await getDb();

  const [targetRow] = await orm
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, targetId))
    .limit(1);
  if (!targetRow) throw notFound('User not found');

  // Check no existing relationship
  const [existing] = await orm
    .select({ id: schema.friendships.id, status: schema.friendships.status })
    .from(schema.friendships)
    .where(
      or(
        and(eq(schema.friendships.requesterId, userId), eq(schema.friendships.addresseeId, targetId)),
        and(eq(schema.friendships.requesterId, targetId), eq(schema.friendships.addresseeId, userId)),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.status === 'accepted') throw badRequest('Already friends');
    if (existing.status === 'pending') throw badRequest('Request already pending');
    if (existing.status === 'blocked') throw badRequest('Cannot send request');
  }

  await orm.insert(schema.friendships).values({
    requesterId: userId,
    addresseeId: targetId,
    status: 'pending',
  });

  // Notify the addressee of the new incoming friend request — powers the
  // blue "new request" dot on the Friends page Requests tab (unread,
  // type = 'friend_request'). Best-effort: a notification failure must not
  // block the friend request itself.
  insertNotification(
    orm,
    targetId,
    'friend_request',
    'New friend request',
    `@${auth.user.username} sent you a friend request`,
    { requesterId: userId, requesterUsername: auth.user.username },
  ).catch(() => {});

  // Award XP for sending a friend request (PRD §6: +10 XP social track)
  const xpAmount = XP_VALUES.add_new_friend;
  orm
    .update(schema.users)
    .set({
      xpTotal: sql`${schema.users.xpTotal} + ${xpAmount}`,
      xpSocial: sql`${schema.users.xpSocial} + ${xpAmount}`,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, userId))
    .catch(() => {});
  orm
    .insert(schema.xpLedger)
    .values({
      userId,
      amount: xpAmount,
      track: 'social',
      source: 'add_new_friend',
      baseAmount: xpAmount,
    })
    .catch(() => {});

  // Increment friend_request new-member quest step (non-fatal)
  void advanceNewMemberQuestFriendRequestStep(orm, userId);

  return NextResponse.json({ success: true }, { status: 201 });
});
