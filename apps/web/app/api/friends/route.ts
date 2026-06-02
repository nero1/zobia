/**
 * Friend relationship management — list and send requests.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { badRequest, notFound } from '@/lib/api/errors';
import { getDb } from '@/lib/db';

/** GET /api/friends — list accepted friends */
export const GET = withAuth(async (req: NextRequest, userId: string) => {
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor');
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 100);

  const db = await getDb();
  const rows = await db.query(
    `SELECT f.id, f.created_at,
            u.id AS friend_id, u.username, u.display_name, u.avatar_emoji, u.rank_name,
            u.is_creator, u.is_verified, u.plan
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.user_id = $1 THEN f.friend_id ELSE f.user_id END
     WHERE (f.user_id = $1 OR f.friend_id = $1)
       AND f.status = 'accepted'
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

/** POST /api/friends — send a friend request */
export const POST = withAuth(async (req: NextRequest, userId: string) => {
  const body = await req.json();
  const targetId: string | undefined = body?.userId;

  if (!targetId) return badRequest('userId is required');
  if (targetId === userId) return badRequest('Cannot add yourself');

  const db = await getDb();

  const [target] = await db.query('SELECT id FROM users WHERE id = $1', [targetId]);
  if (!target) return notFound('User not found');

  // Check no existing relationship
  const [existing] = await db.query(
    `SELECT id, status FROM friendships
     WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
    [userId, targetId],
  );
  if (existing) {
    if (existing.status === 'accepted') return badRequest('Already friends');
    if (existing.status === 'pending') return badRequest('Request already pending');
    if (existing.status === 'blocked') return badRequest('Cannot send request');
  }

  await db.query(
    `INSERT INTO friendships (user_id, friend_id, status)
     VALUES ($1, $2, 'pending')`,
    [userId, targetId],
  );

  return NextResponse.json({ success: true }, { status: 201 });
});
