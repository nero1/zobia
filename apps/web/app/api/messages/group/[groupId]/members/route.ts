export const dynamic = 'force-dynamic';

/**
 * Group chat member management: list, invite/add, remove/leave.
 *
 * Invitation permission (PRD): only the group admin, and any participant the
 * admin has explicitly granted `can_invite`, may invite by default. The
 * group (or the admin, via manifest.groupChatInvite.anyMemberCanInvite /
 * group_chats.allow_any_member_invite) can instead allow any member to invite.
 *
 * Invitee privacy (users.group_invite_privacy: anybody | friends | nobody,
 * default friends) and group-blocks (group_chat_blocks) gate who a given
 * inviter may actually invite — see resolveInviteDenialReason() below for the
 * exact user-facing copy this drives.
 *
 * NOTE: `group_chats.allow_any_member_invite`/`is_business`/`business_join_credit_*`,
 * `group_chat_members.can_invite`, `users.group_invite_privacy`, and the
 * `group_chat_blocks` table are not present in lib/db/schema.ts (schema/DB
 * mismatch — reported upstream; see lib/plans/groupChatSweep.ts for the same
 * gap), so those reads/writes use Drizzle's `sql` tag directly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sql, eq, and, or } from 'drizzle-orm';
import { withAuth } from '@/lib/api/middleware';
import { badRequest, forbidden, notFound } from '@/lib/api/errors';
import { getDb, schema } from '@/lib/db/drizzle';
import { loadManifest } from '@/lib/manifest';
import { creditCoins } from '@/lib/economy/coins';
import { logger } from '@/lib/logger';

type GroupRow = Record<string, unknown> & {
  member_count: number;
  max_members: number;
  allow_any_member_invite: boolean | null;
  is_business: boolean;
  business_join_credit_enabled: boolean;
  business_join_credit_amount: number | null;
  is_active: boolean;
  is_deactivated: boolean;
};

/** GET — list group members (any member, including the creator, can view the full roster). */
export const GET = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { groupId: string }; auth: { user: { sub: string } } },
) => {
  const userId = auth.user.sub;
  const { groupId } = await params;
  const orm = await getDb();

  const [membership] = await orm
    .select({ role: schema.groupChatMembers.role })
    .from(schema.groupChatMembers)
    .where(and(eq(schema.groupChatMembers.groupChatId, groupId), eq(schema.groupChatMembers.userId, userId)));
  if (!membership) throw forbidden('Not a member of this group');

  const result = await orm.execute(sql`
    SELECT gcm.user_id, gcm.role, gcm.joined_at, gcm.can_invite,
           gcm.muted_until, gcm.muted_reason,
           u.username, u.display_name, u.avatar_emoji, u.rank_name
    FROM group_chat_members gcm
    JOIN users u ON u.id = gcm.user_id
    WHERE gcm.group_chat_id = ${groupId}
    ORDER BY gcm.role DESC, gcm.joined_at ASC
  `);

  return NextResponse.json({ data: result.rows });
});

// ---------------------------------------------------------------------------
// Invite permission + invitee-privacy resolution
// ---------------------------------------------------------------------------

/**
 * Returns null if `inviterId` may invite `targetId` into `groupId`, or an
 * error payload `{ message, hint }` describing exactly why not (per PRD copy
 * rules — the "hint" mini-text is omitted when the block is on the group/
 * admin side rather than the invitee's own privacy choice).
 */
async function resolveInviteDenialReason(
  groupId: string,
  groupName: string,
  inviterId: string,
  targetId: string,
): Promise<{ message: string; hint: string | null } | null> {
  const orm = await getDb();

  // The group (or its admin) being blocked by the invitee takes priority and
  // never reveals the invitee's actual privacy setting.
  const groupBlockResult = await orm.execute<{ id: string }>(sql`
    SELECT id FROM group_chat_blocks WHERE group_chat_id = ${groupId} AND user_id = ${targetId} LIMIT 1
  `);
  if (groupBlockResult.rows[0]) {
    return { message: `You are not allowed to invite this user to ${groupName}.`, hint: null };
  }

  const privacyResult = await orm.execute<{ group_invite_privacy: string }>(sql`
    SELECT COALESCE(group_invite_privacy, 'friends') AS group_invite_privacy
    FROM users WHERE id = ${targetId} AND deleted_at IS NULL LIMIT 1
  `);
  const privacy = privacyResult.rows[0]?.group_invite_privacy ?? 'friends';

  if (privacy === 'nobody') {
    return {
      message: 'You are not allowed to invite this user.',
      hint: 'This user has opted not to receive group invitations from anybody.',
    };
  }

  if (privacy === 'friends') {
    const [friendRow] = await orm
      .select({ id: schema.friendships.id })
      .from(schema.friendships)
      .where(and(
        or(
          and(eq(schema.friendships.requesterId, inviterId), eq(schema.friendships.addresseeId, targetId)),
          and(eq(schema.friendships.requesterId, targetId), eq(schema.friendships.addresseeId, inviterId)),
        ),
        eq(schema.friendships.status, 'accepted'),
      ))
      .limit(1);
    if (!friendRow) {
      return {
        message: 'You are not allowed to invite this user.',
        hint: 'This user has opted not to receive group invitations from non-friends.',
      };
    }
  }

  // privacy === 'anybody', or 'friends' with an accepted friendship — allowed.
  return null;
}

/** POST — invite/add a member */
export const POST = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { groupId: string }; auth: { user: { sub: string } } },
) => {
  const userId = auth.user.sub;
  const { groupId } = await params;
  const body = await req.json();
  const targetId: string | undefined = body?.userId;
  if (!targetId) throw badRequest('userId is required');
  if (targetId === userId) throw badRequest('You are already in this group');

  const orm = await getDb();

  const [membership] = await orm
    .select({ role: schema.groupChatMembers.role })
    .from(schema.groupChatMembers)
    .where(and(eq(schema.groupChatMembers.groupChatId, groupId), eq(schema.groupChatMembers.userId, userId)));
  if (!membership) throw forbidden('Not a member of this group');

  const canInviteResult = await orm.execute<{ can_invite: boolean }>(sql`
    SELECT can_invite FROM group_chat_members WHERE group_chat_id = ${groupId} AND user_id = ${userId}
  `);
  const canInviteFlag = canInviteResult.rows[0]?.can_invite ?? false;

  const groupResult = await orm.execute<GroupRow & { name: string }>(sql`
    SELECT member_count, max_members, allow_any_member_invite, is_business,
           business_join_credit_enabled, business_join_credit_amount,
           is_active, is_deactivated, name
    FROM group_chats WHERE id = ${groupId}
  `);
  const group = groupResult.rows[0];
  if (!group || !group.is_active || group.is_deactivated) throw notFound('Group not found');

  // Invite permission: admin, an admin-selected participant, or — if allowed —
  // any member.
  const manifest = await loadManifest();
  const anyMemberCanInvite = group.allow_any_member_invite ?? manifest.groupChatInvite.anyMemberCanInvite;
  const canInvite = membership.role === 'admin' || canInviteFlag || anyMemberCanInvite;
  if (!canInvite) throw forbidden('You are not allowed to invite people to this group');

  if (group.member_count >= group.max_members) throw badRequest('Group is at capacity');

  const denial = await resolveInviteDenialReason(groupId, group.name, userId, targetId);
  if (denial) {
    throw forbidden(denial.message, 'GROUP_INVITE_NOT_ALLOWED', denial.hint ? { hint: denial.hint } : undefined);
  }

  const [inserted] = await orm
    .insert(schema.groupChatMembers)
    .values({ groupChatId: groupId, userId: targetId, role: 'member' })
    .onConflictDoNothing()
    .returning({ userId: schema.groupChatMembers.userId });
  const wasAdded = !!inserted;

  if (wasAdded) {
    await orm
      .update(schema.groupChats)
      .set({ memberCount: sql`${schema.groupChats.memberCount} + 1` })
      .where(eq(schema.groupChats.id, groupId));

    // Business accounts may configure a one-time credit on first join.
    // "Rejoins after leaving earn nothing" — enforced by creditCoins'
    // idempotency on (userId, type, referenceId), keyed per-group-per-user
    // for life, independent of the membership row being deleted on leave.
    if (group.is_business && group.business_join_credit_enabled && group.business_join_credit_amount) {
      creditCoins(
        targetId,
        group.business_join_credit_amount,
        'group_join_credit',
        `group_join_credit:${groupId}:${targetId}`,
        `Joined "${group.name}" for the first time`,
        { groupId },
      ).catch((err) => logger.error({ err }, '[group/members:POST] join credit failed'));
    }
  }

  return NextResponse.json({ success: true });
});

/** DELETE — remove a member (self-leave, or admin removes anyone) */
export const DELETE = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { groupId: string }; auth: { user: { sub: string } } },
) => {
  const userId = auth.user.sub;
  const { groupId } = await params;
  const body = await req.json();
  const targetId: string | undefined = body?.userId;
  if (!targetId) throw badRequest('userId is required');

  const orm = await getDb();

  const [membership] = await orm
    .select({ role: schema.groupChatMembers.role })
    .from(schema.groupChatMembers)
    .where(and(eq(schema.groupChatMembers.groupChatId, groupId), eq(schema.groupChatMembers.userId, userId)));
  // Allow self-removal or admin removal
  if (!membership) throw forbidden('Not a member');
  if (targetId !== userId && membership.role !== 'admin') throw forbidden('Admin only');

  await orm
    .delete(schema.groupChatMembers)
    .where(and(eq(schema.groupChatMembers.groupChatId, groupId), eq(schema.groupChatMembers.userId, targetId)));

  await orm
    .update(schema.groupChats)
    .set({ memberCount: sql`GREATEST(0, ${schema.groupChats.memberCount} - 1)` })
    .where(eq(schema.groupChats.id, groupId));

  return NextResponse.json({ success: true });
});
