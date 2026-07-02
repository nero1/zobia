export const dynamic = 'force-dynamic';

/**
 * app/api/notifications/read-all/route.ts
 *
 * POST /api/notifications/read-all
 * POST /api/notifications/read-all  { type: string }
 *
 * Marks unread notifications for the authenticated user as read. With no
 * body (or an empty body), marks ALL unread notifications as read. When a
 * `type` is supplied, only notifications of that type are marked — used by
 * the Friends page to clear the "new request" dot without also dismissing
 * unrelated notifications (e.g. gift/DM alerts) in the bell menu.
 *
 * Idempotent — calling multiple times has no additional effect.
 *
 * Response: { markedRead: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

/**
 * Mark notifications as read for the authenticated user, optionally scoped
 * to a single `type`.
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    const body = await req.json().catch(() => ({}));
    const type: string | undefined = typeof body?.type === "string" ? body.type : undefined;

    const result = await db.query<{ count: string }>(
      `WITH updated AS (
         UPDATE notifications
         SET is_read = true, updated_at = NOW()
         WHERE user_id = $1 AND is_read = false
           AND ($2::text IS NULL OR type = $2::text)
         RETURNING id
       )
       SELECT COUNT(*)::text AS count FROM updated`,
      [userId, type ?? null]
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
