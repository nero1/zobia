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
 *
 * NOTE: `group_chat_blocks` is not present in lib/db/schema.ts (schema/DB
 * mismatch — reported upstream; see lib/plans/groupChatSweep.ts for the same
 * pattern with group_chats.is_deactivated), so this uses Drizzle's `sql` tag
 * directly rather than the query builder.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { withAuth } from '@/lib/api/middleware';
import { getDb } from '@/lib/db/drizzle';

export const POST = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { groupId: string }; auth: { user: { sub: string } } },
) => {
  const { groupId } = await params;
  const orm = await getDb();
  await orm.execute(sql`
    INSERT INTO group_chat_blocks (group_chat_id, user_id)
    VALUES (${groupId}, ${auth.user.sub})
    ON CONFLICT (group_chat_id, user_id) DO NOTHING
  `);
  return NextResponse.json({ success: true });
});

export const DELETE = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { groupId: string }; auth: { user: { sub: string } } },
) => {
  const { groupId } = await params;
  const orm = await getDb();
  await orm.execute(sql`
    DELETE FROM group_chat_blocks WHERE group_chat_id = ${groupId} AND user_id = ${auth.user.sub}
  `);
  return NextResponse.json({ success: true });
});
