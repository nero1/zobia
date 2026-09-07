export const dynamic = 'force-dynamic';

/**
 * app/api/messages/group/[groupId]/block/route.ts
 *
 * POST   — block a group chat (hides it from the user's list, and the group
 *          — or its admin inviting on its behalf — can no longer invite them;
 *          see resolveInviteDenialReason() in ../members/route.ts).
 * DELETE — unblock.
 *
 * Blocking a group does not remove existing membership — mirrors
 * app/api/users/[userId]/block/route.ts's "silent, idempotent" behavior.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { db } from '@/lib/db';

export const POST = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { groupId: string }; auth: { user: { sub: string } } },
) => {
  const { groupId } = await params;
  await db.query(
    `INSERT INTO group_chat_blocks (group_chat_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (group_chat_id, user_id) DO NOTHING`,
    [groupId, auth.user.sub],
  );
  return NextResponse.json({ success: true });
});

export const DELETE = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { groupId: string }; auth: { user: { sub: string } } },
) => {
  const { groupId } = await params;
  await db.query(
    `DELETE FROM group_chat_blocks WHERE group_chat_id = $1 AND user_id = $2`,
    [groupId, auth.user.sub],
  );
  return NextResponse.json({ success: true });
});
