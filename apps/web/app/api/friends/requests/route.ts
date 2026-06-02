/**
 * GET /api/friends/requests — list incoming pending friend requests.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { getDb } from '@/lib/db';

export const GET = withAuth(async (req: NextRequest, userId: string) => {
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor');
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 100);

  const db = await getDb();
  const rows = await db.query(
    `SELECT f.id, f.created_at,
            u.id AS requester_id, u.username, u.display_name, u.avatar_emoji, u.rank_name
     FROM friendships f
     JOIN users u ON u.id = f.user_id
     WHERE f.friend_id = $1
       AND f.status = 'pending'
       AND ($2::uuid IS NULL OR f.id < $2::uuid)
     ORDER BY f.created_at DESC
     LIMIT $3`,
    [userId, cursor ?? null, limit + 1],
  );

  const hasNextPage = rows.length > limit;
  const data = hasNextPage ? rows.slice(0, limit) : rows;

  return NextResponse.json({
    data,
    pagination: { hasNextPage, nextCursor: hasNextPage ? data[data.length - 1].id : null },
  });
});
