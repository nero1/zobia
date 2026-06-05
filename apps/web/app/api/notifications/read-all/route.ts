/**
 * app/api/notifications/read-all/route.ts
 *
 * POST /api/notifications/read-all
 *
 * Marks all unread notifications for the authenticated user as read.
 * Idempotent — calling multiple times has no additional effect.
 *
 * Response: { markedRead: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

/**
 * Mark all notifications as read for the authenticated user.
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const result = await db.query<{ count: string }>(
      `WITH updated AS (
         UPDATE notifications
         SET is_read = true, updated_at = NOW()
         WHERE user_id = $1 AND is_read = false
         RETURNING id
       )
       SELECT COUNT(*)::text AS count FROM updated`,
      [userId]
    );

    const markedRead = parseInt(result.rows[0]?.count ?? "0", 10);

    return NextResponse.json({
      success: true,
      data: { markedRead },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
