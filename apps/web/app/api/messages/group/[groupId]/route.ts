export const dynamic = 'force-dynamic';

/**
 * Group chat message feed and message posting.
 *
 * Anti-spam: links, phone numbers, and email addresses are silently blocked
 * for regular members. Group admins bypass the filter. Auto-moderation
 * (profanity, duplicate-message, bot-velocity) also runs for non-admins,
 * matching the room-messages route.
 *
 * XP: Awards 2 XP (social track) per message, capped at 50 messages/day,
 * via the shared safeAwardXP DLQ-backed helper.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, validateBody } from '@/lib/api/middleware';
import { forbidden, badRequest } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { filterPublicContent } from '@/lib/messaging/antispam';
import { applyAutoModeration } from '@/lib/moderation/contentFilter';
import { XP_VALUES, ROOM_MESSAGE_XP_DAILY_CAP } from '@/lib/xp/engine';
import { safeAwardXP } from '@/lib/xp/safeAwardXP';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rateLimit';
import { recordWarContribution } from '@/lib/guilds/recordWarContribution';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const sendGroupMessageSchema = z.object({
  content: z
    .string()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message cannot exceed 2000 characters'),
  messageType: z.enum(['text', 'sticker', 'gif', 'gift', 'system']).default('text'),
  idempotencyKey: z.string().max(128).optional(),
});

interface GroupMessageRow {
  id: string;
  sender_id: string;
  group_chat_id: string;
  message_type: string;
  content: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Award social XP for a group message, keyed on the message's own UUID so
 * each message gets a unique idempotency reference (GROUP-XP race fix).
 * Non-blocking, capped at 50 messages/day.
 */
async function maybeAwardGroupMessageXP(groupId: string, messageId: string, userId: string): Promise<void> {
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
    await safeAwardXP(userId, xp, 'social', 'group_message', messageId);

    // Award 1 XP to all other active members (active in last 7 days, PRD §10).
    // reference_id is the same messageId for every member — uidx_xp_ledger_source_ref
    // is unique on (user_id, source, reference_id), so different members don't collide.
    const { rows: activeMembers } = await db.query<{ user_id: string }>(
      `SELECT gcm.user_id
       FROM group_chat_members gcm
       JOIN users u ON u.id = gcm.user_id
       WHERE gcm.group_chat_id = $1
         AND gcm.user_id != $2
         AND u.last_active_at > NOW() - INTERVAL '7 days'
         AND u.deleted_at IS NULL`,
      [groupId, userId]
    );
    await Promise.all(
      activeMembers.map((m) => safeAwardXP(m.user_id, 1, 'social', 'group_message_member', messageId))
    );
  } catch (err) {
    console.error('[group:POST] XP award failed (non-fatal):', err);
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
  if (!memberRows[0]) throw forbidden('Not a member of this group');

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

  await enforceRateLimit(userId, 'user', RATE_LIMITS.messageSend);

  const body = await validateBody(req, sendGroupMessageSchema);

  // Check membership and role
  const { rows: memberRows } = await db.query(
    'SELECT role FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  if (!memberRows[0]) throw forbidden('Not a member of this group');

  const isAdmin = memberRows[0].role === 'admin';

  // Idempotency check — mirrors the DM route's existing-row check so offline-queued
  // group messages retried on reconnect don't create duplicates (OFFLINE-IDEMP-GAP).
  if (body.idempotencyKey) {
    const { rows: dupRows } = await db.query<{ id: string }>(
      `SELECT id FROM messages WHERE sender_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [userId, body.idempotencyKey]
    );
    if (dupRows[0]) {
      const { rows: existingRows } = await db.query<GroupMessageRow>(
        `SELECT * FROM messages WHERE id = $1 LIMIT 1`,
        [dupRows[0].id]
      );
      return NextResponse.json({ data: existingRows[0] }, { status: 200 });
    }
  }

  // Fetch sender's verification/trust for auto-moderation context
  const { rows: senderRows } = await db.query<{
    plan: string;
    is_verified: boolean;
    trust_score: number;
  }>(
    `SELECT COALESCE(plan, 'free') AS plan,
            COALESCE(is_verified, false) AS is_verified,
            COALESCE(trust_score, 50) AS trust_score
     FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId],
  );
  const senderPlan = senderRows[0]?.plan ?? 'free';

  let content = body.content;

  // Layer-1 auto-moderation: bot detection, duplicate detection, profanity filter
  if (!isAdmin && body.messageType === 'text') {
    const sender = senderRows[0] ?? { is_verified: false, trust_score: 50 };
    const modResult = await applyAutoModeration(
      { content, senderId: userId, roomId: groupId },
      { id: groupId },
      { id: userId, is_verified: sender.is_verified, trust_score: sender.trust_score },
      db
    );
    if (modResult.blocked) {
      throw badRequest(
        modResult.reason === 'bot_behavior'
          ? 'Message blocked: unusual sending velocity detected'
          : 'Message blocked: duplicate content detected'
      );
    }
    content = modResult.filteredContent;
  }

  // Anti-spam filter (silent — content stripped, not blocked)
  content = filterPublicContent(content, isAdmin);
  if (body.messageType === 'text' && !content.trim()) {
    throw badRequest('Message content is empty after content filtering');
  }

  const { rows: msgRows } = await db.query<GroupMessageRow>(
    `INSERT INTO messages (sender_id, group_chat_id, message_type, content, idempotency_key, sender_plan_at_creation)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [userId, groupId, body.messageType, content, body.idempotencyKey ?? null, senderPlan],
  );
  const message = msgRows[0];

  // Update group's updated_at
  await db.query(
    'UPDATE group_chats SET updated_at = NOW() WHERE id = $1',
    [groupId],
  );

  // Award social XP for group messaging (non-blocking, PRD §6)
  void maybeAwardGroupMessageXP(groupId, message.id, userId);

  // Record guild war contribution (non-blocking)
  recordWarContribution(userId, 'send_message', db).catch((err) =>
    console.error('[group:POST] war contribution failed', err)
  );

  return NextResponse.json({ data: message }, { status: 201 });
});
