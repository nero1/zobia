export const dynamic = 'force-dynamic';

/**
 * GET /api/friends/requests/sent — list pending friend requests sent by the user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { db } from '@/lib/db';

export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  const userId = auth.user.sub;
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor');
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 100);

  const { rows } = await db.query(
    `SELECT f.id, f.created_at,
            u.id AS addressee_id, u.username, u.display_name, u.avatar_emoji
     FROM friendships f
     JOIN users u ON u.id = f.addressee_id
     WHERE f.requester_id = $1
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
