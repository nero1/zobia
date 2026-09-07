export const dynamic = 'force-dynamic';

/**
 * app/api/messages/group/[groupId]/reactivate/route.ts
 *
 * POST — the creator opts a specific deactivated group back in after
 * renewing their subscription. Re-checks the current active-group limit
 * (a reactivated group counts against it again, same as creating a new
 * one) so reactivation can't silently bypass manifest.groupChatCreationLimits.
 * Records the decision in group_chat_reactivation_choices for audit/idempotency.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withAuth, validateBody } from '@/lib/api/middleware';
import { badRequest, forbidden, handleApiError, notFound } from '@/lib/api/errors';
import { resolveGroupCreationEligibility } from '@/lib/groupChats/eligibility';

interface GroupRow {
  creator_id: string;
  is_active: boolean;
  is_deactivated: boolean;
}

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

    const { rows } = await db.query<GroupRow>(
      `SELECT creator_id, is_active, is_deactivated FROM group_chats WHERE id = $1`,
      [groupId],
    );
    const group = rows[0];
    if (!group || !group.is_active) throw notFound('Group not found');
    if (group.creator_id !== userId) throw forbidden('Only the group creator can reactivate this group');

    if (!reactivate) {
      await db.query(
        `INSERT INTO group_chat_reactivation_choices (group_chat_id, user_id, reactivated)
         VALUES ($1, $2, FALSE)
         ON CONFLICT (group_chat_id, user_id) DO UPDATE SET reactivated = FALSE, decided_at = NOW()`,
        [groupId, userId],
      );
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

    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE group_chats SET is_deactivated = FALSE, deactivated_at = NULL, deactivated_reason = NULL, updated_at = NOW()
         WHERE id = $1`,
        [groupId],
      );
      await tx.query(
        `INSERT INTO group_chat_reactivation_choices (group_chat_id, user_id, reactivated)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (group_chat_id, user_id) DO UPDATE SET reactivated = TRUE, decided_at = NOW()`,
        [groupId, userId],
      );
    });

    return NextResponse.json({ success: true, data: { alreadyActive: false } });
  } catch (err) {
    return handleApiError(err);
  }
});
