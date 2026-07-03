export const dynamic = 'force-dynamic';

/**
 * app/api/notifications/read/route.ts
 *
 * POST /api/notifications/read  { ids: string[] }
 *
 * Marks a specific set of notifications as read for the authenticated user
 * (used when a single notification is tapped, as opposed to
 * /api/notifications/read-all which marks everything read at once).
 * Ids that don't belong to the caller or don't exist are silently ignored.
 *
 * Response: { markedRead: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

const readNotificationsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    const { ids } = await validateBody(req, readNotificationsSchema);

    const result = await db.query<{ count: string }>(
      `WITH updated AS (
         UPDATE notifications
         SET is_read = true, updated_at = NOW()
         WHERE user_id = $1 AND id = ANY($2::uuid[]) AND is_read = false
         RETURNING id
       )
       SELECT COUNT(*)::text AS count FROM updated`,
      [userId, ids]
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
