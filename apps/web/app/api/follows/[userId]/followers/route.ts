export const dynamic = 'force-dynamic';

/**
 * GET /api/follows/[userId]/followers
 * Returns followers of a given user (paginated).
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, lt } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/drizzle';

export async function GET(
  req: NextRequest,
  { params: _params }: { params: Promise<{ userId: string }> },
) {
  const params = await _params;
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor');
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 100);

  const orm = await getDb();
  const rows = await orm
    .select({
      id: schema.follows.id,
      follower_id: schema.follows.followerId,
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
    .innerJoin(schema.users, eq(schema.users.id, schema.follows.followerId))
    .where(
      and(
        eq(schema.follows.followingId, params.userId),
        cursor ? lt(schema.follows.id, cursor) : undefined,
      ),
    )
    .orderBy(desc(schema.follows.createdAt))
    .limit(limit + 1);

  const hasNextPage = rows.length > limit;
  const data = hasNextPage ? rows.slice(0, limit) : rows;

  return NextResponse.json({
    data,
    pagination: { hasNextPage, nextCursor: hasNextPage ? data[data.length - 1].id : null },
  });
}
