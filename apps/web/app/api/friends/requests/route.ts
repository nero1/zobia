export const dynamic = 'force-dynamic';

/**
 * GET /api/friends/requests — list incoming pending friend requests.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { and, desc, eq, lt } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/drizzle';

export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  const userId = auth.user.sub;
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor');
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 100);

  const orm = await getDb();
  const rows = await orm
    .select({
      id: schema.friendships.id,
      created_at: schema.friendships.createdAt,
      requester_id: schema.users.id,
      username: schema.users.username,
      display_name: schema.users.displayName,
      avatar_emoji: schema.users.avatarEmoji,
      avatar_url: schema.users.avatarUrl,
      rank_name: schema.users.rankName,
    })
    .from(schema.friendships)
    .innerJoin(schema.users, eq(schema.users.id, schema.friendships.requesterId))
    .where(
      and(
        eq(schema.friendships.addresseeId, userId),
        eq(schema.friendships.status, 'pending'),
        cursor ? lt(schema.friendships.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(schema.friendships.createdAt))
    .limit(limit + 1);

  const hasNextPage = rows.length > limit;
  const data = hasNextPage ? rows.slice(0, limit) : rows;

  return NextResponse.json({
    data,
    pagination: { hasNextPage, nextCursor: hasNextPage ? data[data.length - 1].id : null },
  });
});
