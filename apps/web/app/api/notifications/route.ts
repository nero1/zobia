export const dynamic = 'force-dynamic';

/**
 * app/api/notifications/route.ts
 *
 * GET  /api/notifications?limit=&after=&type=&unread=
 *   Returns the most recent notifications for the authenticated user,
 *   keyset-paginated on created_at via the `after` cursor. Optionally
 *   filtered by `type` and/or `unread=true`.
 *   Response: { notifications: Notification[], unreadCount: number, nextCursor: string | null, hasMore: boolean }
 *
 * POST /api/notifications/read-all  →  see /app/api/notifications/read-all/route.ts
 *   Marks all notifications as read for the authenticated user.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Constants / schema
// ---------------------------------------------------------------------------

/** Maximum notifications returned per request. */
const NOTIFICATION_LIMIT = 50;

const listNotificationsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(Math.max(parseInt(v, 10), 1), NOTIFICATION_LIMIT) : 20)),
  after: z.string().optional(),
  type: z.string().max(64).optional(),
  unread: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotificationRow {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  title: string | null;
  body: string | null;
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

interface Notification {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  title: string | null;
  body: string | null;
  metadata: Record<string, unknown> | null;
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
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiRead);

    const { limit, after, type, unread } = validateSearchParams(
      req.nextUrl.searchParams,
      listNotificationsQuerySchema
    );

    const conditions = ["user_id = $1"];
    const queryParams: (string | number | boolean)[] = [userId];

    if (type) {
      queryParams.push(type);
      conditions.push(`type = $${queryParams.length}`);
    }
    if (unread) {
      conditions.push("is_read = false");
    }
    if (after) {
      queryParams.push(after);
      conditions.push(`created_at < $${queryParams.length}`);
    }
    queryParams.push(limit);
    const limitPlaceholder = `$${queryParams.length}`;

    const [result, countResult] = await Promise.all([
      db.query<NotificationRow>(
        `SELECT id, type, payload, title, body, metadata, is_read, created_at
         FROM notifications
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT ${limitPlaceholder}`,
        queryParams
      ),
      db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND is_read = false`,
        [userId]
      ),
    ]);

    const notifications: Notification[] = result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      payload: row.payload,
      title: row.title,
      body: row.body,
      metadata: row.metadata,
      isRead: row.is_read,
      createdAt: row.created_at,
    }));

    const unreadCount = parseInt(countResult.rows[0]?.count ?? "0", 10);
    const nextCursor =
      notifications.length === limit
        ? notifications[notifications.length - 1]?.createdAt ?? null
        : null;

    return NextResponse.json({
      notifications,
      unreadCount,
      nextCursor,
      hasMore: nextCursor !== null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
