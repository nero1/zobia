export const dynamic = 'force-dynamic';

/**
 * app/api/messages/group/[groupId]/reactivate/route.ts
 *
 * POST — the creator opts a specific deactivated group back in after
 * renewing their subscription. Re-checks the current active-group limit
 * (a reactivated group counts against it again, same as creating a new
 * one) so reactivation can't silently bypass manifest.groupChatCreationLimits.
 * Records the decision in group_chat_reactivation_choices for audit/idempotency.
 *
 * NOTE: `group_chats.is_deactivated` / `deactivated_at` / `deactivated_reason`
 * and the `group_chat_reactivation_choices` table are not present in
 * lib/db/schema.ts (schema/DB mismatch — reported upstream; see
 * lib/plans/groupChatSweep.ts for the same gap), so this uses Drizzle's
 * `sql` tag directly rather than the query builder.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/drizzle';
import { withAuth, validateBody } from '@/lib/api/middleware';
import { badRequest, forbidden, handleApiError, notFound } from '@/lib/api/errors';
import { resolveGroupCreationEligibility } from '@/lib/groupChats/eligibility';

type GroupRow = Record<string, unknown> & {
  creator_id: string;
  is_active: boolean;
  is_deactivated: boolean;
};

const bodySchema = z.object({
  /** false = "keep deactivated" — records the decline so the renewal prompt doesn't resurface it. */
  reactivate: z.boolean().default(true),
});

export const POST = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { groupId: string }; auth: { user: { sub: string } } },
) => {
  try {
    const userId = auth.user.sub;
    const { groupId } = await params;
    const { reactivate } = await validateBody(req, bodySchema);
    const orm = await getDb();

    const result = await orm.execute<GroupRow>(sql`
      SELECT creator_id, is_active, is_deactivated FROM group_chats WHERE id = ${groupId}
    `);
    const group = result.rows[0];
    if (!group || !group.is_active) throw notFound('Group not found');
    if (group.creator_id !== userId) throw forbidden('Only the group creator can reactivate this group');

    if (!reactivate) {
      await orm.execute(sql`
        INSERT INTO group_chat_reactivation_choices (group_chat_id, user_id, reactivated)
        VALUES (${groupId}, ${userId}, FALSE)
        ON CONFLICT (group_chat_id, user_id) DO UPDATE SET reactivated = FALSE, decided_at = NOW()
      `);
      return NextResponse.json({ success: true, data: { alreadyActive: false, reactivated: false } });
    }

    if (!group.is_deactivated) {
      // Already active — idempotent no-op rather than an error.
      return NextResponse.json({ success: true, data: { alreadyActive: true } });
    }

    const eligibility = await resolveGroupCreationEligibility(userId);
    if (!eligibility.allowed) {
      throw badRequest(
        `You've reached your limit of ${eligibility.limit} active group chat(s) for your plan. Deactivate or upgrade to reactivate this one.`,
        'GROUP_CREATION_LIMIT_REACHED',
      );
    }

    await orm.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE group_chats SET is_deactivated = FALSE, deactivated_at = NULL, deactivated_reason = NULL, updated_at = NOW()
        WHERE id = ${groupId}
      `);
      await tx.execute(sql`
        INSERT INTO group_chat_reactivation_choices (group_chat_id, user_id, reactivated)
        VALUES (${groupId}, ${userId}, TRUE)
        ON CONFLICT (group_chat_id, user_id) DO UPDATE SET reactivated = TRUE, decided_at = NOW()
      `);
    });

    return NextResponse.json({ success: true, data: { alreadyActive: false } });
  } catch (err) {
    return handleApiError(err);
  }
});
