export const dynamic = 'force-dynamic';

/**
 * app/api/messages/group/[groupId]/members/[userId]/mute/route.ts
 *
 * POST /api/messages/group/:groupId/members/:userId/mute
 *   Group admin suspends a member from posting for a fixed duration
 *   (30m, 1h, 3h, 1d, 3d, 7d, 30d), or lifts an active suspension early by
 *   passing `durationMinutes: null`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, validateBody } from '@/lib/api/middleware';
import { badRequest, forbidden, notFound } from '@/lib/api/errors';
import { db } from '@/lib/db';

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

  const { rows: adminRows } = await db.query<{ role: string }>(
    'SELECT role FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [groupId, adminId],
  );
  if (!adminRows[0] || adminRows[0].role !== 'admin') throw forbidden('Admin only');

  const { rows: targetRows } = await db.query<{ user_id: string }>(
    'SELECT user_id FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2',
    [groupId, targetId],
  );
  if (!targetRows[0]) throw notFound('User is not a member of this group');
  if (targetId === adminId) throw badRequest('You cannot suspend yourself');

  const mutedUntil = durationMinutes === null
    ? null
    : new Date(Date.now() + durationMinutes * 60_000).toISOString();

  await db.query(
    `UPDATE group_chat_members
     SET muted_until = $1, muted_by = $2, muted_reason = $3
     WHERE group_chat_id = $4 AND user_id = $5`,
    [mutedUntil, durationMinutes === null ? null : adminId, durationMinutes === null ? null : (reason ?? null), groupId, targetId],
  );

  return NextResponse.json({ success: true, data: { mutedUntil } });
});
