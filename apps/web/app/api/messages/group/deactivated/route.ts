export const dynamic = 'force-dynamic';

/**
 * app/api/messages/group/deactivated/route.ts
 *
 * GET — list the current user's deactivated group chats (grace period
 * elapsed without renewal). Drives the renewal-time reactivation prompt:
 * "users who have group chats are asked if they want to reactivate them
 * (option to select or deselect each one separately)".
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { handleApiError } from '@/lib/api/errors';
import { listDeactivatedGroupsForUser } from '@/lib/plans/groupChatSweep';

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const groups = await listDeactivatedGroupsForUser(auth.user.sub);
    return NextResponse.json({ data: groups });
  } catch (err) {
    return handleApiError(err);
  }
});
