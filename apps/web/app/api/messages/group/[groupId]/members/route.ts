export const dynamic = 'force-dynamic';

/**
 * Group chat member management.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { badRequest, forbidden, notFound } from '@/lib/api/errors';
import { db } from '@/lib/db';

/** GET — list group members */
export const GET = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { groupId: string }; auth: { user: { sub: string } } },
) => {
  const userId = auth.user.sub;
  const { groupId } = await params;

  const { rows: memberRows } = await db.query(
    'SELECT role FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  if (!memberRows[0]) throw forbidden('Not a member of this group');

  const { rows: members } = await db.query(
    `SELECT gcm.user_id, gcm.role, gcm.joined_at,
            u.username, u.display_name, u.avatar_emoji, u.rank_name
     FROM group_chat_members gcm
     JOIN users u ON u.id = gcm.user_id
     WHERE gcm.group_chat_id = $1
     ORDER BY gcm.role DESC, gcm.joined_at ASC`,
    [groupId],
  );

  return NextResponse.json({ data: members });
});

/** POST — add a member */
export const POST = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { groupId: string }; auth: { user: { sub: string } } },
) => {
  const userId = auth.user.sub;
  const { groupId } = await params;
  const body = await req.json();
  const targetId: string | undefined = body?.userId;
  if (!targetId) throw badRequest('userId is required');

  // Only admins can add members
  const { rows: memberRows } = await db.query(
    'SELECT role FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  if (!memberRows[0] || memberRows[0].role !== 'admin') throw forbidden('Admin only');

  const { rows: groupRows } = await db.query<{ member_count: number; max_members: number }>(
    'SELECT member_count, max_members FROM group_chats WHERE id = $1',
    [groupId],
  );
  if (!groupRows[0]) throw notFound('Group not found');
  if (groupRows[0].member_count >= groupRows[0].max_members) throw badRequest('Group is at capacity');

  await db.query(
    `INSERT INTO group_chat_members (group_chat_id, user_id, role)
     VALUES ($1, $2, 'member')
     ON CONFLICT (group_chat_id, user_id) DO NOTHING`,
    [groupId, targetId],
  );

  await db.query(
    'UPDATE group_chats SET member_count = member_count + 1 WHERE id = $1',
    [groupId],
  );

  return NextResponse.json({ success: true });
});

/** DELETE — remove a member */
export const DELETE = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { groupId: string }; auth: { user: { sub: string } } },
) => {
  const userId = auth.user.sub;
  const { groupId } = await params;
  const body = await req.json();
  const targetId: string | undefined = body?.userId;
  if (!targetId) throw badRequest('userId is required');

  const { rows: memberRows } = await db.query(
    'SELECT role FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  // Allow self-removal or admin removal
  if (!memberRows[0]) throw forbidden('Not a member');
  if (targetId !== userId && memberRows[0].role !== 'admin') throw forbidden('Admin only');

  await db.query(
    'DELETE FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [groupId, targetId],
  );
  await db.query(
    'UPDATE group_chats SET member_count = GREATEST(0, member_count - 1) WHERE id = $1',
    [groupId],
  );

  return NextResponse.json({ success: true });
});
