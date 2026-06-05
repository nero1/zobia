/**
 * Individual friendship management — accept, reject, block, or remove.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { badRequest, forbidden, notFound } from '@/lib/api/errors';
import { getDb } from '@/lib/db';
import { XP_VALUES } from '@/lib/xp/engine';

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

  const { rows: friendshipRows } = await db.query(
    `SELECT id, requester_id, addressee_id, status FROM friendships
     WHERE id = $1`,
    [params.friendId],
  );
  const friendship = friendshipRows[0];
  if (!friendship) return notFound('Friendship not found');

  // Only the recipient (addressee) can accept/reject; either party can block
  if (action === 'accept' || action === 'reject') {
    if (friendship.addressee_id !== userId) return forbidden('Not the request recipient');
    if (friendship.status !== 'pending') return badRequest('Request is not pending');
  }

  if (action === 'block') {
    if (friendship.requester_id !== userId && friendship.addressee_id !== userId) {
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

    // Award XP on accept (PRD §6: +5 XP social track to addressee)
    if (action === 'accept') {
      const xpAmount = XP_VALUES.accept_friend_request;
      await db.query(
        `UPDATE users SET xp_total = xp_total + $1, updated_at = NOW() WHERE id = $2`,
        [xpAmount, userId],
      ).catch(() => {});
      await db.query(
        `INSERT INTO xp_ledger (user_id, amount, track, source, base_amount, created_at)
         VALUES ($1, $2, 'social', 'accept_friend_request', $2, NOW())`,
        [userId, xpAmount],
      ).catch(() => {});
    }
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

  const { rows: dRows } = await db.query(
    `SELECT id, requester_id, addressee_id FROM friendships
     WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)`,
    [params.friendId, userId],
  );
  const friendship = dRows[0];
  if (!friendship) return notFound('Friendship not found');

  await db.query('DELETE FROM friendships WHERE id = $1', [params.friendId]);

  return NextResponse.json({ success: true });
});
