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
 *
 * NOTE: `group_chats.allow_any_member_invite` and `group_chat_members.can_invite`
 * are not present in lib/db/schema.ts (schema/DB mismatch — reported upstream,
 * same gap documented in lib/plans/groupChatSweep.ts), so this uses Drizzle's
 * `sql` tag directly rather than the query builder.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withAuth, validateBody } from '@/lib/api/middleware';
import { forbidden, notFound } from '@/lib/api/errors';
import { getDb } from '@/lib/db/drizzle';

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
  const orm = await getDb();

  const memberResult = await orm.execute<{ role: string }>(sql`
    SELECT role FROM group_chat_members WHERE group_chat_id = ${groupId} AND user_id = ${userId}
  `);
  if (!memberResult.rows[0] || memberResult.rows[0].role !== 'admin') throw forbidden('Admin only');

  const groupResult = await orm.execute<{ id: string }>(sql`
    SELECT id FROM group_chats WHERE id = ${groupId}
  `);
  if (!groupResult.rows[0]) throw notFound('Group not found');

  if (body.anyMemberCanInvite !== undefined) {
    await orm.execute(sql`
      UPDATE group_chats SET allow_any_member_invite = ${body.anyMemberCanInvite}, updated_at = NOW() WHERE id = ${groupId}
    `);
  }

  if (body.grant?.length) {
    await orm.execute(sql`
      UPDATE group_chat_members SET can_invite = TRUE
      WHERE group_chat_id = ${groupId} AND user_id = ANY(${body.grant}::uuid[])
    `);
  }

  if (body.revoke?.length) {
    await orm.execute(sql`
      UPDATE group_chat_members SET can_invite = FALSE
      WHERE group_chat_id = ${groupId} AND user_id = ANY(${body.revoke}::uuid[])
    `);
  }

  return NextResponse.json({ success: true });
});
