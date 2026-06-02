/**
 * Group chat member management.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { badRequest, forbidden, notFound } from '@/lib/api/errors';
import { getDb } from '@/lib/db';

/** GET — list group members */
export const GET = withAuth(async (
  req: NextRequest,
  userId: string,
  { params }: { params: { groupId: string } },
) => {
  const database = await getDb();
  const [membership] = await database.query(
    'SELECT role FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [params.groupId, userId],
  );
  if (!membership) return forbidden('Not a member of this group');

  const members = await database.query(
    `SELECT gcm.user_id, gcm.role, gcm.joined_at,
            u.username, u.display_name, u.avatar_emoji, u.rank_name
     FROM group_chat_members gcm
     JOIN users u ON u.id = gcm.user_id
     WHERE gcm.group_chat_id = $1
     ORDER BY gcm.role DESC, gcm.joined_at ASC`,
    [params.groupId],
  );

  return NextResponse.json({ data: members });
});

/** POST — add a member */
export const POST = withAuth(async (
  req: NextRequest,
  userId: string,
  { params }: { params: { groupId: string } },
) => {
  const body = await req.json();
  const targetId: string | undefined = body?.userId;
  if (!targetId) return badRequest('userId is required');

  const database = await getDb();

  // Only admins can add members
  const [membership] = await database.query(
    'SELECT role FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [params.groupId, userId],
  );
  if (!membership || membership.role !== 'admin') return forbidden('Admin only');

  const [group] = await database.query(
    'SELECT member_count, max_members FROM group_chats WHERE id = $1',
    [params.groupId],
  );
  if (!group) return notFound('Group not found');
  if (group.member_count >= group.max_members) return badRequest('Group is at capacity');

  await database.query(
    `INSERT INTO group_chat_members (group_chat_id, user_id, role)
     VALUES ($1, $2, 'member')
     ON CONFLICT (group_chat_id, user_id) DO NOTHING`,
    [params.groupId, targetId],
  );

  await database.query(
    'UPDATE group_chats SET member_count = member_count + 1 WHERE id = $1',
    [params.groupId],
  );

  return NextResponse.json({ success: true });
});

/** DELETE — remove a member */
export const DELETE = withAuth(async (
  req: NextRequest,
  userId: string,
  { params }: { params: { groupId: string } },
) => {
  const body = await req.json();
  const targetId: string | undefined = body?.userId;
  if (!targetId) return badRequest('userId is required');

  const database = await getDb();

  const [membership] = await database.query(
    'SELECT role FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [params.groupId, userId],
  );
  // Allow self-removal or admin removal
  if (!membership) return forbidden('Not a member');
  if (targetId !== userId && membership.role !== 'admin') return forbidden('Admin only');

  await database.query(
    'DELETE FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [params.groupId, targetId],
  );
  await database.query(
    'UPDATE group_chats SET member_count = GREATEST(0, member_count - 1) WHERE id = $1',
    [params.groupId],
  );

  return NextResponse.json({ success: true });
});
