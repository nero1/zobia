/**
 * Individual friendship management — accept, reject, block, or remove.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { badRequest, forbidden, notFound, handleApiError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { XP_VALUES } from '@/lib/xp/engine';

/** PUT /api/friends/[friendId] — accept, reject, or block */
export const PUT = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: Promise<{ friendId: string }>; auth: { user: { sub: string } } },
) => {
  try {
    const { friendId } = await params;
    const userId = auth.user.sub;

    const body = await req.json();
    const action: string | undefined = body?.action; // 'accept' | 'reject' | 'block'
    if (!action || !['accept', 'reject', 'block'].includes(action)) {
      return badRequest('action must be accept, reject, or block');
    }

    const { rows: friendshipRows } = await db.query(
      `SELECT id, requester_id, addressee_id, status FROM friendships
       WHERE id = $1`,
      [friendId],
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
      await db.query('DELETE FROM friendships WHERE id = $1', [friendId]);
    } else {
      const newStatus = action === 'accept' ? 'accepted' : 'blocked';
      await db.query(
        'UPDATE friendships SET status = $1, updated_at = NOW() WHERE id = $2',
        [newStatus, friendId],
      );

      // Award XP on accept to BOTH parties (PRD §15)
      if (action === 'accept') {
        const xpAmount = XP_VALUES.accept_friend_request;
        const requesterXP = XP_VALUES.add_new_friend;

        // Award accept_friend_request XP to addressee
        await db.query(
          `UPDATE users SET xp_total = xp_total + $1, xp_social = xp_social + $1, updated_at = NOW() WHERE id = $2`,
          [xpAmount, userId],
        ).catch(() => {});
        await db.query(
          `INSERT INTO xp_ledger (user_id, amount, track, source, base_amount, created_at)
           VALUES ($1, $2, 'social', 'accept_friend_request', $2, NOW())`,
          [userId, xpAmount],
        ).catch(() => {});

        // Award add_new_friend XP to requester
        await db.query(
          `UPDATE users SET xp_total = xp_total + $1, xp_social = xp_social + $1, updated_at = NOW() WHERE id = $2`,
          [requesterXP, friendship.requester_id],
        ).catch(() => {});
        await db.query(
          `INSERT INTO xp_ledger (user_id, amount, track, source, base_amount, created_at)
           VALUES ($1, $2, 'social', 'add_new_friend', $2, NOW())`,
          [friendship.requester_id, requesterXP],
        ).catch(() => {});
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
});

/** DELETE /api/friends/[friendId] — remove a friend */
export const DELETE = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: Promise<{ friendId: string }>; auth: { user: { sub: string } } },
) => {
  try {
    const { friendId } = await params;
    const userId = auth.user.sub;

    const { rows: dRows } = await db.query(
      `SELECT id, requester_id, addressee_id FROM friendships
       WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)`,
      [friendId, userId],
    );
    const friendship = dRows[0];
    if (!friendship) return notFound('Friendship not found');

    await db.query('DELETE FROM friendships WHERE id = $1', [friendId]);

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
});
