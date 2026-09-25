export const dynamic = 'force-dynamic';

/**
 * app/api/messages/group/[groupId]/members/[userId]/mute/route.ts
 *
 * POST /api/messages/group/:groupId/members/:userId/mute
 *   Group admin suspends a member from posting for a fixed duration
 *   (30m, 1h, 3h, 1d, 3d, 7d, 30d), or lifts an active suspension early by
 *   passing `durationMinutes: null`.
 *
 * NOTE: `group_chat_members.muted_by` / `muted_reason` are not present in
 * lib/db/schema.ts's groupChatMembers table (schema/DB mismatch — reported
 * upstream, same gap documented in lib/plans/groupChatSweep.ts), so this uses
 * Drizzle's `sql` tag directly rather than the query builder.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withAuth, validateBody } from '@/lib/api/middleware';
import { badRequest, forbidden, notFound } from '@/lib/api/errors';
import { getDb } from '@/lib/db/drizzle';

/** Allowed suspension durations, in minutes — matches the PRD's fixed option set. */
const ALLOWED_DURATION_MINUTES = [30, 60, 180, 1440, 4320, 10080, 43200];

const bodySchema = z.object({
  durationMinutes: z.union([z.number().int(), z.null()]),
  reason: z.string().max(500).optional(),
});

export const POST = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { groupId: string; userId: string }; auth: { user: { sub: string } } },
) => {
  const adminId = auth.user.sub;
  const { groupId, userId: targetId } = await params;
  const { durationMinutes, reason } = await validateBody(req, bodySchema);

  if (durationMinutes !== null && !ALLOWED_DURATION_MINUTES.includes(durationMinutes)) {
    throw badRequest('durationMinutes must be one of: 30, 60, 180, 1440, 4320, 10080, 43200 (or null to lift)');
  }

  const orm = await getDb();

  const adminResult = await orm.execute<{ role: string }>(sql`
    SELECT role FROM group_chat_members WHERE group_chat_id = ${groupId} AND user_id = ${adminId}
  `);
  if (!adminResult.rows[0] || adminResult.rows[0].role !== 'admin') throw forbidden('Admin only');

  const targetResult = await orm.execute<{ user_id: string }>(sql`
    SELECT user_id FROM group_chat_members WHERE group_chat_id = ${groupId} AND user_id = ${targetId}
  `);
  if (!targetResult.rows[0]) throw notFound('User is not a member of this group');
  if (targetId === adminId) throw badRequest('You cannot suspend yourself');

  const mutedUntil = durationMinutes === null
    ? null
    : new Date(Date.now() + durationMinutes * 60_000).toISOString();
  const mutedBy = durationMinutes === null ? null : adminId;
  const mutedReason = durationMinutes === null ? null : (reason ?? null);

  await orm.execute(sql`
    UPDATE group_chat_members
    SET muted_until = ${mutedUntil}, muted_by = ${mutedBy}, muted_reason = ${mutedReason}
    WHERE group_chat_id = ${groupId} AND user_id = ${targetId}
  `);

  return NextResponse.json({ success: true, data: { mutedUntil } });
});
