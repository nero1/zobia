/**
 * Individual friendship management — accept, reject, block, or remove.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { badRequest, forbidden, notFound } from '@/lib/api/errors';
import { getDb } from '@/lib/db';

/** PUT /api/friends/[friendId] — accept, reject, or block */
export const PUT = withAuth(async (
  req: NextRequest,
  userId: string,
  { params }: { params: { friendId: string } },
) => {
  const body = await req.json();
  const action: string | undefined = body?.action; // 'accept' | 'reject' | 'block'
  if (!action || !['accept', 'reject', 'block'].includes(action)) {
    return badRequest('action must be accept, reject, or block');
  }

  const db = await getDb();

  const [friendship] = await db.query(
    `SELECT id, user_id, friend_id, status FROM friendships
     WHERE id = $1`,
    [params.friendId],
  );
  if (!friendship) return notFound('Friendship not found');

  // Only the recipient can accept/reject; either party can block
  if (action === 'accept' || action === 'reject') {
    if (friendship.friend_id !== userId) return forbidden('Not the request recipient');
    if (friendship.status !== 'pending') return badRequest('Request is not pending');
  }

  if (action === 'block') {
    if (friendship.user_id !== userId && friendship.friend_id !== userId) {
      return forbidden('Not part of this friendship');
    }
  }

  if (action === 'reject') {
    await db.query('DELETE FROM friendships WHERE id = $1', [params.friendId]);
  } else {
    const newStatus = action === 'accept' ? 'accepted' : 'blocked';
    await db.query(
      'UPDATE friendships SET status = $1, updated_at = NOW() WHERE id = $2',
      [newStatus, params.friendId],
    );
  }

  return NextResponse.json({ success: true });
});

/** DELETE /api/friends/[friendId] — remove a friend */
export const DELETE = withAuth(async (
  req: NextRequest,
  userId: string,
  { params }: { params: { friendId: string } },
) => {
  const db = await getDb();

  const [friendship] = await db.query(
    `SELECT id, user_id, friend_id FROM friendships
     WHERE id = $1 AND (user_id = $2 OR friend_id = $2)`,
    [params.friendId, userId],
  );
  if (!friendship) return notFound('Friendship not found');

  await db.query('DELETE FROM friendships WHERE id = $1', [params.friendId]);

  return NextResponse.json({ success: true });
});
