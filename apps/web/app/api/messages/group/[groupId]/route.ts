export const dynamic = 'force-dynamic';

/**
 * Group chat message feed and message posting.
 *
 * Anti-spam: links, phone numbers, and email addresses are silently blocked
 * for regular members. Group admins bypass the filter. Auto-moderation
 * (profanity, duplicate-message, bot-velocity) also runs for non-admins,
 * matching the room-messages route.
 *
 * Rewards: posting in a group chat earns NO XP, quest progress, or guild-war
 * contribution — group chats are plain utility chat. The one deliberate
 * exception (PRD): a Business account group creator may configure a one-time
 * credit on first join and/or a per-message credit for a member's first N
 * messages in the group — see maybeAwardBusinessMessageCredit() below.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, validateBody } from '@/lib/api/middleware';
import { forbidden, badRequest, notFound } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { filterPublicContent } from '@/lib/messaging/antispam';
import { applyAutoModeration } from '@/lib/moderation/contentFilter';
import { creditCoins } from '@/lib/economy/coins';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rateLimit';
import { publishRealtimeEvent } from '@/lib/realtime';
import { notifyGroupMessage } from '@/lib/notifications/chatPush';
import { logger } from "@/lib/logger";

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

interface GroupRow {
  name: string;
  is_active: boolean;
  is_deactivated: boolean;
  is_business: boolean;
  business_message_credit_enabled: boolean;
  business_message_credit_amount: number | null;
  business_message_credit_threshold: number | null;
}

/**
 * Business-configured credit for a member's first N messages in a group
 * (PRD: "business accounts, the group creator can configure group members
 * to receive credits ... when they send their first x number of messages").
 * Awards `business_message_credit_amount` per message until
 * `credited_message_count` reaches `business_message_credit_threshold`,
 * then stops — non-blocking, idempotent on the message's own UUID.
 */
async function maybeAwardBusinessMessageCredit(group: GroupRow, groupId: string, userId: string, messageId: string): Promise<void> {
  if (!group.is_business || !group.business_message_credit_enabled) return;
  const threshold = group.business_message_credit_threshold ?? 0;
  const amount = group.business_message_credit_amount ?? 0;
  if (threshold <= 0 || amount <= 0) return;

  try {
    const { rows } = await db.query<{ credited_message_count: number }>(
      `UPDATE group_chat_members
       SET credited_message_count = credited_message_count + 1
       WHERE group_chat_id = $1 AND user_id = $2 AND credited_message_count < $3
       RETURNING credited_message_count`,
      [groupId, userId, threshold],
    );
    if (!rows[0]) return; // Already past the threshold — no more credits.

    await creditCoins(
      userId,
      amount,
      'group_message_credit',
      `group_message_credit:${messageId}`,
      `Message ${rows[0].credited_message_count}/${threshold} in "${group.name}"`,
      { groupId },
    );
  } catch (err) {
    logger.error({ err }, '[group:POST] business message credit failed (non-fatal)');
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
  // Delta fetch: only messages at/after this ISO timestamp (ascending). The live
  // poll uses this to fetch just new messages; boundary rows dedupe client-side.
  const after = searchParams.get('after');
  const deltaMode = !!after && !Number.isNaN(Date.parse(after));

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
       ${deltaMode ? 'AND m.created_at >= $2::timestamptz' : 'AND ($2::uuid IS NULL OR m.id < $2::uuid)'}
       ${historyFilter}
     ORDER BY m.created_at ${deltaMode ? 'ASC' : 'DESC'}
     LIMIT $3`,
    [groupId, deltaMode ? after : (cursor ?? null), deltaMode ? limit : limit + 1],
  );

  // Cursor pagination only applies to the backlog query, not delta polling.
  const hasNextPage = !deltaMode && rows.length > limit;
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

  // Check membership, role, and mute status
  const { rows: memberRows } = await db.query<{ role: string; muted_until: string | null }>(
    'SELECT role, muted_until FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  if (!memberRows[0]) throw forbidden('Not a member of this group');
  if (memberRows[0].muted_until && new Date(memberRows[0].muted_until) > new Date()) {
    throw forbidden(
      `You have been suspended from posting in this group until ${new Date(memberRows[0].muted_until).toISOString()}.`,
      'GROUP_MUTED',
      { mutedUntil: memberRows[0].muted_until },
    );
  }

  const { rows: groupRows } = await db.query<GroupRow>(
    `SELECT name, is_active, is_deactivated, is_business,
            business_message_credit_enabled, business_message_credit_amount, business_message_credit_threshold
     FROM group_chats WHERE id = $1`,
    [groupId],
  );
  const group = groupRows[0];
  if (!group || !group.is_active) throw notFound('Group not found');
  if (group.is_deactivated) throw forbidden('This group is deactivated', 'GROUP_DEACTIVATED');

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

  // Fetch sender's verification/trust for auto-moderation context, plus the
  // public profile fields used to render the bubble (so the HTTP response and
  // realtime echo are complete and don't show "@undefined").
  const { rows: senderRows } = await db.query<{
    plan: string;
    is_verified: boolean;
    trust_score: number;
    username: string;
    display_name: string | null;
    avatar_emoji: string | null;
    rank_name: string | null;
  }>(
    `SELECT COALESCE(plan, 'free') AS plan,
            COALESCE(is_verified, false) AS is_verified,
            COALESCE(trust_score, 50) AS trust_score,
            username, display_name, avatar_emoji, rank_name
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
  // Attach the sender's public profile so clients render the bubble (name +
  // avatar) immediately, matching the shape returned by the list endpoint's
  // JOIN on users.
  const enriched = {
    ...msgRows[0],
    username: senderRows[0]?.username ?? '',
    display_name: senderRows[0]?.display_name ?? senderRows[0]?.username ?? '',
    avatar_emoji: senderRows[0]?.avatar_emoji ?? '👤',
    rank_name: senderRows[0]?.rank_name ?? null,
  };
  const message = enriched;

  // Update group's updated_at
  await db.query(
    'UPDATE group_chats SET updated_at = NOW() WHERE id = $1',
    [groupId],
  );

  // The only reward posting in a group chat can earn: a Business creator's
  // configured first-N-messages credit. No XP, quests, or war contribution.
  void maybeAwardBusinessMessageCredit(group, groupId, userId, message.id);

  // Realtime broadcast — push to open clients so group members see new messages
  // instantly (the 3s poll remains the guaranteed-delivery fallback).
  void publishRealtimeEvent(`group:${groupId}:messages`, 'new_message', { message });

  // Push notification to offline members (excludes the sender + online users).
  void (async () => {
    const { rows: memberIdRows } = await db.query<{ user_id: string }>(
      'SELECT user_id FROM group_chat_members WHERE group_chat_id = $1',
      [groupId],
    );
    await notifyGroupMessage({
      memberIds: memberIdRows.map((r) => r.user_id),
      senderId: userId,
      senderName: enriched.display_name || enriched.username || 'Someone',
      groupName: group.name,
      text: content,
      groupId,
    });
  })();

  return NextResponse.json({ data: message }, { status: 201 });
});
