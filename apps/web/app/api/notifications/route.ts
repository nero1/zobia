export const dynamic = 'force-dynamic';

/**
 * app/api/notifications/route.ts
 *
 * GET  /api/notifications
 *   Returns the 50 most recent notifications for the authenticated user.
 *   Response: { notifications: Notification[], unreadCount: number }
 *
 * POST /api/notifications/read-all  →  see /app/api/notifications/read-all/route.ts
 *   Marks all notifications as read for the authenticated user.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum notifications returned per request. */
const NOTIFICATION_LIMIT = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotificationRow {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

interface Notification {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// GET /api/notifications
// ---------------------------------------------------------------------------

/**
 * Returns the latest notifications for the authenticated user.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;

    const result = await db.query<NotificationRow>(
      `SELECT id, type, payload, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, NOTIFICATION_LIMIT]
    );

    const notifications: Notification[] = result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      payload: row.payload,
      isRead: row.is_read,
      createdAt: row.created_at,
    }));

    const unreadCount = notifications.filter((n) => !n.isRead).length;

    return NextResponse.json({
      success: true,
      data: {
        notifications,
        unreadCount,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
