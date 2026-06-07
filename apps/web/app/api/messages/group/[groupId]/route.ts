/**
 * Group chat message feed and message posting.
 *
 * Anti-spam: links, phone numbers, and email addresses are silently blocked
 * for regular members. Group admins bypass the filter.
 *
 * XP: Awards 2 XP (social track) per message, capped at 50 messages/day.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { forbidden, notFound } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { filterPublicContent } from '@/lib/messaging/antispam';
import { XP_VALUES, ROOM_MESSAGE_XP_DAILY_CAP } from '@/lib/xp/engine';
import { recordWarContribution } from '@/lib/guilds/recordWarContribution';

/** Award social XP for group messages (non-blocking, capped at 50/day). */
async function maybeAwardGroupMessageXP(groupId: string, userId: string): Promise<void> {
  try {
    const { rows: countRows } = await db.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt
       FROM messages
       WHERE group_chat_id = $1
         AND sender_id = $2
         AND created_at >= CURRENT_DATE`,
      [groupId, userId]
    );
    const todayCount = parseInt(countRows[0]?.cnt ?? '0', 10);
    if (todayCount > ROOM_MESSAGE_XP_DAILY_CAP) return;

    const xp = XP_VALUES.send_message_in_room; // 2 XP
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE users
         SET xp_total = xp_total + $1,
             xp_social = xp_social + $1,
             updated_at = NOW()
         WHERE id = $2`,
        [xp, userId]
      );
      await tx.query(
        `INSERT INTO xp_ledger
           (user_id, amount, track, source, reference_id, multiplier, base_amount)
         VALUES ($1, $2, 'social', 'group_message', $3, 100, $2)`,
        [userId, xp, groupId]
      );

      // Award 1 XP to all other active members (active in last 7 days, PRD §10)
      const { rows: activeMembers } = await tx.query<{ user_id: string }>(
        `SELECT gcm.user_id
         FROM group_chat_members gcm
         JOIN users u ON u.id = gcm.user_id
         WHERE gcm.group_chat_id = $1
           AND gcm.user_id != $2
           AND u.last_active_at > NOW() - INTERVAL '7 days'
           AND u.deleted_at IS NULL`,
        [groupId, userId]
      );
      if (activeMembers.length > 0) {
        const memberIds = activeMembers.map((m) => m.user_id);
        await tx.query(
          `UPDATE users
           SET xp_total = xp_total + 1, xp_social = xp_social + 1, updated_at = NOW()
           WHERE id = ANY($1::uuid[])`,
          [memberIds]
        );
        const ledgerValues = memberIds
          .map((_, i) => `($${i * 2 + 1}, 1, 'social', 'group_message_member', $${i * 2 + 2}, 100, 1)`)
          .join(', ');
        const ledgerParams: (string | number)[] = [];
        for (const mid of memberIds) ledgerParams.push(mid, groupId);
        await tx.query(
          `INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, multiplier, base_amount)
           VALUES ${ledgerValues}`,
          ledgerParams
        );
      }
    });
  } catch {
    // Non-fatal
  }
}

/** GET /api/messages/group/[groupId] — message feed (cursor-paginated) */
export const GET = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { groupId: string }; auth: { user: { sub: string } } },
) => {
  const userId = auth.user.sub;
  const { groupId } = await params;
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor');
  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 100);

  // Check membership
  const { rows: memberRows } = await db.query(
    'SELECT role FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  if (!memberRows[0]) return forbidden('Not a member of this group');

  // Determine message history window based on user's plan
  const { rows: planRows } = await db.query<{ plan: string }>(
    `SELECT COALESCE(plan, 'free') AS plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId],
  );
  const userPlan = planRows[0]?.plan ?? 'free';
  let historyFilter = '';
  if (userPlan === 'free') {
    historyFilter = `AND m.created_at > NOW() - INTERVAL '90 days'`;
  } else if (userPlan === 'plus') {
    historyFilter = `AND m.created_at > NOW() - INTERVAL '180 days'`;
  }

  const { rows } = await db.query(
    `SELECT m.*, u.username, u.display_name, u.avatar_emoji, u.rank_name
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.group_chat_id = $1
       AND m.is_deleted = false
       AND ($2::uuid IS NULL OR m.id < $2::uuid)
       ${historyFilter}
     ORDER BY m.created_at DESC
     LIMIT $3`,
    [groupId, cursor ?? null, limit + 1],
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
  { params, auth }: { params: { groupId: string }; auth: { user: { sub: string } } },
) => {
  const userId = auth.user.sub;
  const { groupId } = await params;
  const body = await req.json();
  const content: string = body?.content ?? '';
  const messageType: string = body?.messageType ?? 'text';

  // Check membership and role
  const { rows: memberRows } = await db.query(
    'SELECT role FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  if (!memberRows[0]) return forbidden('Not a member of this group');

  const isAdmin = memberRows[0].role === 'admin';

  // Anti-spam filter (silent — content stripped, not blocked)
  const filteredContent = filterPublicContent(content, isAdmin);

  // Fetch sender's plan for message creation context
  const { rows: senderRows } = await db.query<{ plan: string }>(
    `SELECT COALESCE(plan, 'free') AS plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId],
  );
  const senderPlan = senderRows[0]?.plan ?? 'free';

  const { rows: msgRows } = await db.query(
    `INSERT INTO messages (sender_id, group_chat_id, message_type, content, sender_plan_at_creation)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, groupId, messageType, filteredContent, senderPlan],
  );

  // Update group's updated_at
  await db.query(
    'UPDATE group_chats SET updated_at = NOW() WHERE id = $1',
    [groupId],
  );

  // Award social XP for group messaging (non-blocking, PRD §6)
  void maybeAwardGroupMessageXP(groupId, userId);

  // Record guild war contribution (non-blocking)
  recordWarContribution(userId, 'send_message', db).catch((err) =>
    console.error('[group:POST] war contribution failed', err)
  );

  return NextResponse.json({ data: msgRows[0] }, { status: 201 });
});
