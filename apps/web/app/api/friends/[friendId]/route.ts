export const dynamic = 'force-dynamic';

/**
 * Individual friendship management — accept, reject, block, or remove.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { badRequest, forbidden, notFound, handleApiError } from '@/lib/api/errors';
import { and, eq, or, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/drizzle';
import { XP_VALUES } from '@/lib/xp/engine';
import { advanceNewMemberQuestStep } from '@/lib/quests/newMemberQuestEngine';

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
      throw badRequest('action must be accept, reject, or block');
    }

    const orm = await getDb();
    const [friendship] = await orm
      .select({
        id: schema.friendships.id,
        requester_id: schema.friendships.requesterId,
        addressee_id: schema.friendships.addresseeId,
        status: schema.friendships.status,
      })
      .from(schema.friendships)
      .where(eq(schema.friendships.id, friendId))
      .limit(1);
    if (!friendship) throw notFound('Friendship not found');

    // Only the recipient (addressee) can accept/reject; either party can block
    if (action === 'accept' || action === 'reject') {
      if (friendship.addressee_id !== userId) throw forbidden('Not the request recipient');
      if (friendship.status !== 'pending') throw badRequest('Request is not pending');
    }

    if (action === 'block') {
      if (friendship.requester_id !== userId && friendship.addressee_id !== userId) {
        throw forbidden('Not part of this friendship');
      }
    }

    if (action === 'reject') {
      await orm.delete(schema.friendships).where(eq(schema.friendships.id, friendId));
    } else {
      const newStatus = action === 'accept' ? 'accepted' : 'blocked';
      await orm
        .update(schema.friendships)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(schema.friendships.id, friendId));

      // Award XP on accept to BOTH parties (PRD §15)
      if (action === 'accept') {
        const xpAmount = XP_VALUES.accept_friend_request;
        const requesterXP = XP_VALUES.add_new_friend;

        // Award accept_friend_request XP to addressee
        orm
          .update(schema.users)
          .set({
            xpTotal: sql`${schema.users.xpTotal} + ${xpAmount}`,
            xpSocial: sql`${schema.users.xpSocial} + ${xpAmount}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, userId))
          .catch(() => {});
        orm
          .insert(schema.xpLedger)
          .values({
            userId,
            amount: xpAmount,
            track: 'social',
            source: 'accept_friend_request',
            baseAmount: xpAmount,
          })
          .catch(() => {});

        // Award add_new_friend XP to requester
        orm
          .update(schema.users)
          .set({
            xpTotal: sql`${schema.users.xpTotal} + ${requesterXP}`,
            xpSocial: sql`${schema.users.xpSocial} + ${requesterXP}`,
            updatedAt: new Date(),
          })
          .where(eq(schema.users.id, friendship.requester_id))
          .catch(() => {});
        orm
          .insert(schema.xpLedger)
          .values({
            userId: friendship.requester_id,
            amount: requesterXP,
            track: 'social',
            source: 'add_new_friend',
            baseAmount: requesterXP,
          })
          .catch(() => {});

        // Both parties now have a new friend — advance the add_friend New Member Quest step
        void advanceNewMemberQuestStep(orm, userId, 'add_friend');
        void advanceNewMemberQuestStep(orm, friendship.requester_id, 'add_friend');
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

    const orm = await getDb();
    const [friendship] = await orm
      .select({
        id: schema.friendships.id,
        requester_id: schema.friendships.requesterId,
        addressee_id: schema.friendships.addresseeId,
      })
      .from(schema.friendships)
      .where(
        and(eq(schema.friendships.id, friendId), or(eq(schema.friendships.requesterId, userId), eq(schema.friendships.addresseeId, userId))),
      )
      .limit(1);
    if (!friendship) throw notFound('Friendship not found');

    await orm.delete(schema.friendships).where(eq(schema.friendships.id, friendId));

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
});
