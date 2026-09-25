export const dynamic = 'force-dynamic';

/**
 * Follow / unfollow API.
 *
 * Follows are one-directional. Users can follow any public profile or creator.
 * Followers receive Broadcast Messages from followed creators.
 * Following does NOT grant DM access.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { badRequest, notFound } from '@/lib/api/errors';
import { and, desc, eq, lt } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/drizzle';

/** GET /api/follows — list users the current user follows */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  const userId = auth.user.sub;
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor');
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 100);

  const orm = await getDb();
  const rows = await orm
    .select({
      id: schema.follows.id,
      following_id: schema.follows.followingId,
      created_at: schema.follows.createdAt,
      username: schema.users.username,
      display_name: schema.users.displayName,
      avatar_emoji: schema.users.avatarEmoji,
      rank_name: schema.users.rankName,
      is_creator: schema.users.isCreator,
      is_verified: schema.users.isVerified,
      plan: schema.users.plan,
    })
    .from(schema.follows)
    .innerJoin(schema.users, eq(schema.users.id, schema.follows.followingId))
    .where(
      and(
        eq(schema.follows.followerId, userId),
        cursor ? lt(schema.follows.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(schema.follows.createdAt))
    .limit(limit + 1);

  const hasNextPage = rows.length > limit;
  const data = hasNextPage ? rows.slice(0, limit) : rows;

  return NextResponse.json({
    data,
    pagination: {
      hasNextPage,
      nextCursor: hasNextPage ? data[data.length - 1].id : null,
    },
  });
});

/** POST /api/follows — follow a user */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  const userId = auth.user.sub;
  const body = await req.json();
  const targetId: string | undefined = body?.userId;

  if (!targetId) throw badRequest('userId is required');
  if (targetId === userId) throw badRequest('Cannot follow yourself');

  const orm = await getDb();

  // Verify target user exists
  const [targetRow] = await orm
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, targetId))
    .limit(1);
  if (!targetRow) throw notFound('User not found');

  // Upsert (idempotent)
  await orm
    .insert(schema.follows)
    .values({ followerId: userId, followingId: targetId })
    .onConflictDoNothing();

  return NextResponse.json({ success: true });
});

/** DELETE /api/follows — unfollow a user */
export const DELETE = withAuth(async (req: NextRequest, { params, auth }) => {
  const userId = auth.user.sub;
  const body = await req.json();
  const targetId: string | undefined = body?.userId;
  if (!targetId) throw badRequest('userId is required');

  const orm = await getDb();
  await orm
    .delete(schema.follows)
    .where(and(eq(schema.follows.followerId, userId), eq(schema.follows.followingId, targetId)));

  return NextResponse.json({ success: true });
});
