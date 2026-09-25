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
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

const readNotificationsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;
    const { ids } = await validateBody(req, readNotificationsSchema);

    const db = await getDb();
    const updated = await db
      .update(schema.notifications)
      .set({ isRead: true, updatedAt: new Date() })
      .where(
        and(
          eq(schema.notifications.userId, userId),
          inArray(schema.notifications.id, ids),
          eq(schema.notifications.isRead, false)
        )
      )
      .returning({ id: schema.notifications.id });

    const markedRead = updated.length;

    return NextResponse.json({
      success: true,
      data: { markedRead },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
