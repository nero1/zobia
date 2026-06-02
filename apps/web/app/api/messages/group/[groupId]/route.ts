/**
 * Group chat message feed and message posting.
 *
 * Anti-spam: links, phone numbers, and email addresses are silently blocked
 * for regular members. Group admins bypass the filter.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { forbidden, notFound } from '@/lib/api/errors';
import { getDb } from '@/lib/db';
import { filterPublicContent } from '@/lib/messaging/antispam';
import { getDb as db } from '@/lib/db';

/** GET /api/messages/group/[groupId] — message feed (cursor-paginated) */
export const GET = withAuth(async (
  req: NextRequest,
  userId: string,
  { params }: { params: { groupId: string } },
) => {
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor');
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 100);

  const database = await getDb();

  // Check membership
  const [membership] = await database.query(
    'SELECT role FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [params.groupId, userId],
  );
  if (!membership) return forbidden('Not a member of this group');

  const rows = await database.query(
    `SELECT m.*, u.username, u.display_name, u.avatar_emoji, u.rank_name
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.group_chat_id = $1
       AND m.is_deleted = false
       AND ($2::uuid IS NULL OR m.id < $2::uuid)
     ORDER BY m.created_at DESC
     LIMIT $3`,
    [params.groupId, cursor ?? null, limit + 1],
  );

  const hasNextPage = rows.length > limit;
  const data = hasNextPage ? rows.slice(0, limit) : rows;

  return NextResponse.json({
    data,
    pagination: { hasNextPage, nextCursor: hasNextPage ? data[data.length - 1].id : null },
  });
});

/** POST /api/messages/group/[groupId] — send a message */
export const POST = withAuth(async (
  req: NextRequest,
  userId: string,
  { params }: { params: { groupId: string } },
) => {
  const body = await req.json();
  const content: string = body?.content ?? '';
  const messageType: string = body?.messageType ?? 'text';

  const database = await getDb();

  // Check membership and role
  const [membership] = await database.query(
    'SELECT role FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [params.groupId, userId],
  );
  if (!membership) return forbidden('Not a member of this group');

  const isAdmin = membership.role === 'admin';

  // Anti-spam filter (silent — content stripped, not blocked)
  const filteredContent = filterPublicContent(content, isAdmin);

  const [message] = await database.query(
    `INSERT INTO messages (sender_id, group_chat_id, message_type, content)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, params.groupId, messageType, filteredContent],
  );

  // Update group's updated_at
  await database.query(
    'UPDATE group_chats SET updated_at = NOW() WHERE id = $1',
    [params.groupId],
  );

  return NextResponse.json({ data: message }, { status: 201 });
});
