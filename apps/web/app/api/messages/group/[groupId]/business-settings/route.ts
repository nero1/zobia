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
 *
 * NOTE: `group_chats.is_business` / `business_join_credit_*` /
 * `business_message_credit_*` are not present in lib/db/schema.ts's
 * groupChats table (schema/DB mismatch — reported upstream; the same gap
 * lib/plans/groupChatSweep.ts documents for is_deactivated), so this uses
 * Drizzle's `sql` tag directly rather than the query builder.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/drizzle';
import { withAuth, validateBody } from '@/lib/api/middleware';
import { badRequest, forbidden, notFound, handleApiError } from '@/lib/api/errors';

type GroupRow = Record<string, unknown> & {
  is_business: boolean;
  business_join_credit_enabled: boolean;
  business_join_credit_amount: number | null;
  business_message_credit_enabled: boolean;
  business_message_credit_amount: number | null;
  business_message_credit_threshold: number | null;
};

const bodySchema = z.object({
  businessJoinCreditEnabled: z.boolean().optional(),
  businessJoinCreditAmount: z.number().int().min(0).max(1_000_000).optional(),
  businessMessageCreditEnabled: z.boolean().optional(),
  businessMessageCreditAmount: z.number().int().min(0).max(1_000_000).optional(),
  businessMessageCreditThreshold: z.number().int().min(0).max(1000).optional(),
});

async function requireBusinessGroupAdmin(groupId: string, userId: string): Promise<GroupRow> {
  const orm = await getDb();

  const memberResult = await orm.execute<{ role: string }>(sql`
    SELECT role FROM group_chat_members WHERE group_chat_id = ${groupId} AND user_id = ${userId}
  `);
  if (!memberResult.rows[0] || memberResult.rows[0].role !== 'admin') throw forbidden('Admin only');

  const result = await orm.execute<GroupRow>(sql`
    SELECT is_business, business_join_credit_enabled, business_join_credit_amount,
           business_message_credit_enabled, business_message_credit_amount, business_message_credit_threshold
    FROM group_chats WHERE id = ${groupId}
  `);
  const group = result.rows[0];
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

    const setClauses: ReturnType<typeof sql>[] = [];
    if (body.businessJoinCreditEnabled !== undefined) {
      setClauses.push(sql`business_join_credit_enabled = ${body.businessJoinCreditEnabled}`);
    }
    if (body.businessJoinCreditAmount !== undefined) {
      setClauses.push(sql`business_join_credit_amount = ${body.businessJoinCreditAmount}`);
    }
    if (body.businessMessageCreditEnabled !== undefined) {
      setClauses.push(sql`business_message_credit_enabled = ${body.businessMessageCreditEnabled}`);
    }
    if (body.businessMessageCreditAmount !== undefined) {
      setClauses.push(sql`business_message_credit_amount = ${body.businessMessageCreditAmount}`);
    }
    if (body.businessMessageCreditThreshold !== undefined) {
      setClauses.push(sql`business_message_credit_threshold = ${body.businessMessageCreditThreshold}`);
    }

    const orm = await getDb();
    await orm.execute(sql`
      UPDATE group_chats SET ${sql.join(setClauses, sql`, `)}, updated_at = NOW() WHERE id = ${groupId}
    `);

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
});
