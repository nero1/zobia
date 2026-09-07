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
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { badRequest, forbidden, notFound } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { loadManifest } from '@/lib/manifest';
import { creditCoins } from '@/lib/economy/coins';
import { logger } from '@/lib/logger';

interface GroupRow {
  member_count: number;
  max_members: number;
  allow_any_member_invite: boolean | null;
  is_business: boolean;
  business_join_credit_enabled: boolean;
  business_join_credit_amount: number | null;
  is_active: boolean;
  is_deactivated: boolean;
}

/** GET — list group members (any member, including the creator, can view the full roster). */
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
    `SELECT gcm.user_id, gcm.role, gcm.joined_at, gcm.can_invite,
            gcm.muted_until, gcm.muted_reason,
            u.username, u.display_name, u.avatar_emoji, u.rank_name
     FROM group_chat_members gcm
     JOIN users u ON u.id = gcm.user_id
     WHERE gcm.group_chat_id = $1
     ORDER BY gcm.role DESC, gcm.joined_at ASC`,
    [groupId],
  );

  return NextResponse.json({ data: members });
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
  // The group (or its admin) being blocked by the invitee takes priority and
  // never reveals the invitee's actual privacy setting.
  const { rows: groupBlockRows } = await db.query<{ id: string }>(
    `SELECT id FROM group_chat_blocks WHERE group_chat_id = $1 AND user_id = $2 LIMIT 1`,
    [groupId, targetId],
  );
  if (groupBlockRows[0]) {
    return { message: `You are not allowed to invite this user to ${groupName}.`, hint: null };
  }

  const { rows: targetRows } = await db.query<{ group_invite_privacy: string }>(
    `SELECT COALESCE(group_invite_privacy, 'friends') AS group_invite_privacy
     FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [targetId],
  );
  const privacy = targetRows[0]?.group_invite_privacy ?? 'friends';

  if (privacy === 'nobody') {
    return {
      message: 'You are not allowed to invite this user.',
      hint: 'This user has opted not to receive group invitations from anybody.',
    };
  }

  if (privacy === 'friends') {
    const { rows: friendRows } = await db.query<{ id: string }>(
      `SELECT id FROM friendships
       WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
         AND status = 'accepted' LIMIT 1`,
      [inviterId, targetId],
    );
    if (!friendRows[0]) {
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

  const { rows: memberRows } = await db.query<{ role: string; can_invite: boolean }>(
    'SELECT role, can_invite FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  const membership = memberRows[0];
  if (!membership) throw forbidden('Not a member of this group');

  const { rows: groupRows } = await db.query<GroupRow & { name: string }>(
    `SELECT member_count, max_members, allow_any_member_invite, is_business,
            business_join_credit_enabled, business_join_credit_amount,
            is_active, is_deactivated, name
     FROM group_chats WHERE id = $1`,
    [groupId],
  );
  const group = groupRows[0];
  if (!group || !group.is_active || group.is_deactivated) throw notFound('Group not found');

  // Invite permission: admin, an admin-selected participant, or — if allowed —
  // any member.
  const manifest = await loadManifest();
  const anyMemberCanInvite = group.allow_any_member_invite ?? manifest.groupChatInvite.anyMemberCanInvite;
  const canInvite = membership.role === 'admin' || membership.can_invite || anyMemberCanInvite;
  if (!canInvite) throw forbidden('You are not allowed to invite people to this group');

  if (group.member_count >= group.max_members) throw badRequest('Group is at capacity');

  const denial = await resolveInviteDenialReason(groupId, group.name, userId, targetId);
  if (denial) {
    throw forbidden(denial.message, 'GROUP_INVITE_NOT_ALLOWED', denial.hint ? { hint: denial.hint } : undefined);
  }

  const { rows: insertRows } = await db.query<{ user_id: string }>(
    `INSERT INTO group_chat_members (group_chat_id, user_id, role)
     VALUES ($1, $2, 'member')
     ON CONFLICT (group_chat_id, user_id) DO NOTHING
     RETURNING user_id`,
    [groupId, targetId],
  );
  const wasAdded = insertRows.length > 0;

  if (wasAdded) {
    await db.query(
      'UPDATE group_chats SET member_count = member_count + 1 WHERE id = $1',
      [groupId],
    );

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
