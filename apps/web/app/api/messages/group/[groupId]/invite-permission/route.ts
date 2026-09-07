export const dynamic = 'force-dynamic';

/**
 * app/api/messages/group/[groupId]/invite-permission/route.ts
 *
 * PATCH /api/messages/group/:groupId/invite-permission — admin-only.
 *
 * Body (all optional):
 *   anyMemberCanInvite: boolean | null — per-group override of
 *     manifest.groupChatInvite.anyMemberCanInvite (null = use the manifest default)
 *   grant:  string[] — user ids to grant can_invite
 *   revoke: string[] — user ids to revoke can_invite
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, validateBody } from '@/lib/api/middleware';
import { forbidden, notFound } from '@/lib/api/errors';
import { db } from '@/lib/db';

const bodySchema = z.object({
  anyMemberCanInvite: z.union([z.boolean(), z.null()]).optional(),
  grant: z.array(z.string().uuid()).max(500).optional(),
  revoke: z.array(z.string().uuid()).max(500).optional(),
});

export const PATCH = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { groupId: string }; auth: { user: { sub: string } } },
) => {
  const userId = auth.user.sub;
  const { groupId } = await params;
  const body = await validateBody(req, bodySchema);

  const { rows: memberRows } = await db.query<{ role: string }>(
    'SELECT role FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  if (!memberRows[0] || memberRows[0].role !== 'admin') throw forbidden('Admin only');

  const { rows: groupRows } = await db.query<{ id: string }>(
    'SELECT id FROM group_chats WHERE id = $1',
    [groupId],
  );
  if (!groupRows[0]) throw notFound('Group not found');

  if (body.anyMemberCanInvite !== undefined) {
    await db.query(
      'UPDATE group_chats SET allow_any_member_invite = $1, updated_at = NOW() WHERE id = $2',
      [body.anyMemberCanInvite, groupId],
    );
  }

  if (body.grant?.length) {
    await db.query(
      `UPDATE group_chat_members SET can_invite = TRUE
       WHERE group_chat_id = $1 AND user_id = ANY($2::uuid[])`,
      [groupId, body.grant],
    );
  }

  if (body.revoke?.length) {
    await db.query(
      `UPDATE group_chat_members SET can_invite = FALSE
       WHERE group_chat_id = $1 AND user_id = ANY($2::uuid[])`,
      [groupId, body.revoke],
    );
  }

  return NextResponse.json({ success: true });
});
