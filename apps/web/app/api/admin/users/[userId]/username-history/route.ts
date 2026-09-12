export const dynamic = 'force-dynamic';

/**
 * app/api/admin/users/[userId]/username-history/route.ts
 *
 * GET /api/admin/users/[userId]/username-history
 *   Admin OR moderator (withModeratorOrAdminAuth — DATABASE-verified, never
 *   just the JWT claim). Lists every username change for this user, newest
 *   first, for the "Username history" section on the gate44 user detail
 *   panel.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

interface AdminUserParams {
  userId: string;
}

interface UsernameHistoryRow {
  id: string;
  old_username: string;
  new_username: string;
  changed_at: string;
  redirect_enabled: boolean;
  reserved_until: string | null;
  cost_paid_credits: number;
  cost_paid_stars: number;
}

export const GET = withModeratorOrAdminAuth<AdminUserParams>(async (req, { params }) => {
  try {
    const { userId } = params;
    const { rows } = await db.query<UsernameHistoryRow>(
      `SELECT id, old_username, new_username, changed_at, redirect_enabled,
              reserved_until, cost_paid_credits, cost_paid_stars
       FROM username_change_history
       WHERE user_id = $1
       ORDER BY changed_at DESC
       LIMIT 100`,
      [userId]
    );
    return NextResponse.json({ success: true, data: { history: rows }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
