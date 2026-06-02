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
import { getDb } from '@/lib/db';

/** GET /api/follows — list users the current user follows */
export const GET = withAuth(async (req: NextRequest, userId: string) => {
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor');
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 100);

  const db = await getDb();
  const rows = await db.query(
    `SELECT f.id, f.following_id, f.created_at,
            u.username, u.display_name, u.avatar_emoji, u.rank_name,
            u.is_creator, u.is_verified, u.plan
     FROM follows f
     JOIN users u ON u.id = f.following_id
     WHERE f.follower_id = $1
       AND ($2::uuid IS NULL OR f.id < $2::uuid)
     ORDER BY f.created_at DESC
     LIMIT $3`,
    [userId, cursor ?? null, limit + 1],
  );

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
export const POST = withAuth(async (req: NextRequest, userId: string) => {
  const body = await req.json();
  const targetId: string | undefined = body?.userId;

  if (!targetId) return badRequest('userId is required');
  if (targetId === userId) return badRequest('Cannot follow yourself');

  const db = await getDb();

  // Verify target user exists
  const [target] = await db.query('SELECT id FROM users WHERE id = $1', [targetId]);
  if (!target) return notFound('User not found');

  // Upsert (idempotent)
  await db.query(
    `INSERT INTO follows (follower_id, following_id)
     VALUES ($1, $2)
     ON CONFLICT (follower_id, following_id) DO NOTHING`,
    [userId, targetId],
  );

  return NextResponse.json({ success: true });
});

/** DELETE /api/follows — unfollow a user */
export const DELETE = withAuth(async (req: NextRequest, userId: string) => {
  const body = await req.json();
  const targetId: string | undefined = body?.userId;
  if (!targetId) return badRequest('userId is required');

  const db = await getDb();
  await db.query(
    'DELETE FROM follows WHERE follower_id = $1 AND following_id = $2',
    [userId, targetId],
  );

  return NextResponse.json({ success: true });
});
