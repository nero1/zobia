export const dynamic = 'force-dynamic';

/**
 * GET /api/follows/[userId]/followers
 * Returns followers of a given user (paginated).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params: _params }: { params: Promise<{ userId: string }> },
) {
  const params = await _params;
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor');
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 100);

  const { rows } = await db.query(
    `SELECT f.id, f.follower_id, f.created_at,
            u.username, u.display_name, u.avatar_emoji, u.rank_name,
            u.is_creator, u.is_verified, u.plan
     FROM follows f
     JOIN users u ON u.id = f.follower_id
     WHERE f.following_id = $1
       AND ($2::uuid IS NULL OR f.id < $2::uuid)
     ORDER BY f.created_at DESC
     LIMIT $3`,
    [params.userId, cursor ?? null, limit + 1],
  );

  const hasNextPage = rows.length > limit;
  const data = hasNextPage ? rows.slice(0, limit) : rows;

  return NextResponse.json({
    data,
    pagination: { hasNextPage, nextCursor: hasNextPage ? data[data.length - 1].id : null },
  });
}
