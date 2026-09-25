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
 *
 * NOTE: `group_chats.is_deactivated` / `is_business` / `business_message_credit_*`
 * are not present in lib/db/schema.ts's groupChats table (schema/DB mismatch —
 * reported upstream; see lib/plans/groupChatSweep.ts for the same gap), so
 * group_chats reads/writes here use Drizzle's `sql` tag directly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sql, eq, and } from 'drizzle-orm';
import { withAuth, validateBody } from '@/lib/api/middleware';
import { forbidden, badRequest, notFound } from '@/lib/api/errors';
import { getDb, schema } from '@/lib/db/drizzle';
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

type GroupRow = Record<string, unknown> & {
  name: string;
  is_active: boolean;
  is_deactivated: boolean;
  is_business: boolean;
  business_message_credit_enabled: boolean;
  business_message_credit_amount: number | null;
  business_message_credit_threshold: number | null;
};

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
    const orm = await getDb();
    const result = await orm.execute<{ credited_message_count: number }>(sql`
      UPDATE group_chat_members
      SET credited_message_count = credited_message_count + 1
      WHERE group_chat_id = ${groupId} AND user_id = ${userId} AND credited_message_count < ${threshold}
      RETURNING credited_message_count
    `);
    if (!result.rows[0]) return; // Already past the threshold — no more credits.

    await creditCoins(
      userId,
      amount,
      'group_message_credit',
      `group_message_credit:${messageId}`,
      `Message ${result.rows[0].credited_message_count}/${threshold} in "${group.name}"`,
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

  const orm = await getDb();

  // Check membership
  const [membership] = await orm
    .select({ role: schema.groupChatMembers.role })
    .from(schema.groupChatMembers)
    .where(and(eq(schema.groupChatMembers.groupChatId, groupId), eq(schema.groupChatMembers.userId, userId)));
  if (!membership) throw forbidden('Not a member of this group');

  // Determine message history window based on user's plan
  const [planRow] = await orm
    .select({ plan: schema.users.plan })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), sql`${schema.users.deletedAt} IS NULL`))
    .limit(1);
  const userPlan = planRow?.plan ?? 'free';
  let historyFilter = sql``;
  if (userPlan === 'free') {
    historyFilter = sql`AND m.created_at > NOW() - INTERVAL '90 days'`;
  } else if (userPlan === 'plus') {
    historyFilter = sql`AND m.created_at > NOW() - INTERVAL '180 days'`;
  }

  const cursorClause = deltaMode
    ? sql`AND m.created_at >= ${after}::timestamptz`
    : sql`AND (${cursor ?? null}::uuid IS NULL OR m.id < ${cursor ?? null}::uuid)`;

  const result = await orm.execute(sql`
    SELECT m.*, u.username, u.display_name, u.avatar_emoji, u.rank_name
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.group_chat_id = ${groupId}
      AND m.is_deleted = false
      ${cursorClause}
      ${historyFilter}
    ORDER BY m.created_at ${deltaMode ? sql`ASC` : sql`DESC`}
    LIMIT ${deltaMode ? limit : limit + 1}
  `);
  const rows = result.rows as Array<Record<string, unknown> & { id: string; created_at: string }>;

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
  const orm = await getDb();

  // Check membership, role, and mute status.
  // NOTE: group_chat_members.muted_until is not present in lib/db/schema.ts
  // (schema/DB mismatch — reported upstream), so it's read via `sql` directly.
  const [membership] = await orm
    .select({ role: schema.groupChatMembers.role })
    .from(schema.groupChatMembers)
    .where(and(eq(schema.groupChatMembers.groupChatId, groupId), eq(schema.groupChatMembers.userId, userId)));
  if (!membership) throw forbidden('Not a member of this group');

  const mutedResult = await orm.execute<Record<string, unknown> & { muted_until: string | null }>(sql`
    SELECT muted_until FROM group_chat_members WHERE group_chat_id = ${groupId} AND user_id = ${userId}
  `);
  const mutedUntil = mutedResult.rows[0]?.muted_until ?? null;
  if (mutedUntil && new Date(mutedUntil) > new Date()) {
    throw forbidden(
      `You have been suspended from posting in this group until ${new Date(mutedUntil).toISOString()}.`,
      'GROUP_MUTED',
      { mutedUntil },
    );
  }

  const groupResult = await orm.execute<GroupRow>(sql`
    SELECT name, is_active, is_deactivated, is_business,
           business_message_credit_enabled, business_message_credit_amount, business_message_credit_threshold
    FROM group_chats WHERE id = ${groupId}
  `);
  const group = groupResult.rows[0];
  if (!group || !group.is_active) throw notFound('Group not found');
  if (group.is_deactivated) throw forbidden('This group is deactivated', 'GROUP_DEACTIVATED');

  const isAdmin = membership.role === 'admin';

  // Idempotency check — mirrors the DM route's existing-row check so offline-queued
  // group messages retried on reconnect don't create duplicates (OFFLINE-IDEMP-GAP).
  if (body.idempotencyKey) {
    const [dup] = await orm
      .select({ id: schema.messages.id })
      .from(schema.messages)
      .where(and(eq(schema.messages.senderId, userId), eq(schema.messages.idempotencyKey, body.idempotencyKey)))
      .limit(1);
    if (dup) {
      const [existing] = await orm.select().from(schema.messages).where(eq(schema.messages.id, dup.id)).limit(1);
      return NextResponse.json(
        { data: existing ? { ...existing, coinCost: Number(existing.coinCost ?? 0) } : existing },
        { status: 200 }
      );
    }
  }

  // Fetch sender's verification/trust for auto-moderation context, plus the
  // public profile fields used to render the bubble (so the HTTP response and
  // realtime echo are complete and don't show "@undefined").
  const [senderRow] = await orm
    .select({
      plan: schema.users.plan,
      isVerified: schema.users.isVerified,
      trustScore: schema.users.trustScore,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatarEmoji: schema.users.avatarEmoji,
      rankName: schema.users.rankName,
    })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), sql`${schema.users.deletedAt} IS NULL`))
    .limit(1);
  const senderPlan = senderRow?.plan ?? 'free';

  let content = body.content;

  // Layer-1 auto-moderation: bot detection, duplicate detection, profanity filter
  if (!isAdmin && body.messageType === 'text') {
    const sender = senderRow
      ? { isVerified: senderRow.isVerified ?? false, trustScore: senderRow.trustScore ?? 50 }
      : { isVerified: false, trustScore: 50 };
    const dbForModeration = await getDb();
    const modResult = await applyAutoModeration(
      { content, senderId: userId, roomId: groupId },
      { id: groupId },
      { id: userId, is_verified: sender.isVerified, trust_score: sender.trustScore },
      dbForModeration
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

  const [insertedMessage] = await orm
    .insert(schema.messages)
    .values({
      senderId: userId,
      groupChatId: groupId,
      messageType: body.messageType,
      content,
      idempotencyKey: body.idempotencyKey ?? null,
      senderPlanAtCreation: senderPlan,
    })
    .returning();

  // Attach the sender's public profile so clients render the bubble (name +
  // avatar) immediately, matching the shape returned by the list endpoint's
  // JOIN on users.
  const enriched = {
    ...insertedMessage,
    // coinCost is a bigint column — convert for JSON serialization (JSON.stringify throws on bigint).
    coinCost: Number(insertedMessage.coinCost ?? 0),
    username: senderRow?.username ?? '',
    display_name: senderRow?.displayName ?? senderRow?.username ?? '',
    avatar_emoji: senderRow?.avatarEmoji ?? '👤',
    rank_name: senderRow?.rankName ?? null,
  };
  const message = enriched;

  // Update group's updated_at
  await orm.execute(sql`UPDATE group_chats SET updated_at = NOW() WHERE id = ${groupId}`);

  // The only reward posting in a group chat can earn: a Business creator's
  // configured first-N-messages credit. No XP, quests, or war contribution.
  void maybeAwardBusinessMessageCredit(group, groupId, userId, message.id);

  // Realtime broadcast — push to open clients so group members see new messages
  // instantly (the 3s poll remains the guaranteed-delivery fallback).
  void publishRealtimeEvent(`group:${groupId}:messages`, 'new_message', { message });

  // Push notification to offline members (excludes the sender + online users).
  void (async () => {
    const memberIdRows = await orm
      .select({ userId: schema.groupChatMembers.userId })
      .from(schema.groupChatMembers)
      .where(eq(schema.groupChatMembers.groupChatId, groupId));
    await notifyGroupMessage({
      memberIds: memberIdRows.map((r) => r.userId),
      senderId: userId,
      senderName: enriched.display_name || enriched.username || 'Someone',
      groupName: group.name,
      text: content,
      groupId,
    });
  })();

  return NextResponse.json({ data: message }, { status: 201 });
});
