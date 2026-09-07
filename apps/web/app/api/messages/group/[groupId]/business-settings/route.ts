export const dynamic = 'force-dynamic';

/**
 * app/api/messages/group/[groupId]/business-settings/route.ts
 *
 * GET/PATCH — Business-account group creator configuration (admin-only,
 * group must be `is_business`): award credits to members who join for the
 * first time, and/or a per-message credit for a member's first N messages.
 * "Rejoins after leaving earn nothing" is enforced by creditCoins'
 * idempotency, not by anything here — see members/route.ts and
 * [groupId]/route.ts's maybeAwardBusinessMessageCredit().
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withAuth, validateBody } from '@/lib/api/middleware';
import { badRequest, forbidden, notFound, handleApiError } from '@/lib/api/errors';

interface GroupRow {
  is_business: boolean;
  business_join_credit_enabled: boolean;
  business_join_credit_amount: number | null;
  business_message_credit_enabled: boolean;
  business_message_credit_amount: number | null;
  business_message_credit_threshold: number | null;
}

const bodySchema = z.object({
  businessJoinCreditEnabled: z.boolean().optional(),
  businessJoinCreditAmount: z.number().int().min(0).max(1_000_000).optional(),
  businessMessageCreditEnabled: z.boolean().optional(),
  businessMessageCreditAmount: z.number().int().min(0).max(1_000_000).optional(),
  businessMessageCreditThreshold: z.number().int().min(0).max(1000).optional(),
});

async function requireBusinessGroupAdmin(groupId: string, userId: string): Promise<GroupRow> {
  const { rows: memberRows } = await db.query<{ role: string }>(
    'SELECT role FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [groupId, userId],
  );
  if (!memberRows[0] || memberRows[0].role !== 'admin') throw forbidden('Admin only');

  const { rows } = await db.query<GroupRow>(
    `SELECT is_business, business_join_credit_enabled, business_join_credit_amount,
            business_message_credit_enabled, business_message_credit_amount, business_message_credit_threshold
     FROM group_chats WHERE id = $1`,
    [groupId],
  );
  const group = rows[0];
  if (!group) throw notFound('Group not found');
  if (!group.is_business) throw forbidden('This setting is only available for Business account groups');
  return group;
}

export const GET = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { groupId: string }; auth: { user: { sub: string } } },
) => {
  try {
    const { groupId } = await params;
    const group = await requireBusinessGroupAdmin(groupId, auth.user.sub);
    return NextResponse.json({ data: group });
  } catch (err) {
    return handleApiError(err);
  }
});

export const PATCH = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { groupId: string }; auth: { user: { sub: string } } },
) => {
  try {
    const { groupId } = await params;
    await requireBusinessGroupAdmin(groupId, auth.user.sub);
    const body = await validateBody(req, bodySchema);

    if (Object.keys(body).length === 0) throw badRequest('No valid fields to update');

    const columnMap: Record<string, string> = {
      businessJoinCreditEnabled: 'business_join_credit_enabled',
      businessJoinCreditAmount: 'business_join_credit_amount',
      businessMessageCreditEnabled: 'business_message_credit_enabled',
      businessMessageCreditAmount: 'business_message_credit_amount',
      businessMessageCreditThreshold: 'business_message_credit_threshold',
    };
    const entries = Object.entries(body).filter(([, v]) => v !== undefined);
    const setClauses = entries.map(([k], i) => `${columnMap[k]} = $${i + 2}`).join(', ');
    const values = [groupId, ...entries.map(([, v]) => v)];

    await db.query(`UPDATE group_chats SET ${setClauses}, updated_at = NOW() WHERE id = $1`, values);

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
});
