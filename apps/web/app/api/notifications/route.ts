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
import { and, desc, eq, lt, count as drizzleCount } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { deriveNotificationActionUrl } from "@/lib/notifications/actionRoute";

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
  // ZSB-16 fix: derived from type + metadata — see lib/notifications/actionRoute.ts.
  actionUrl: string | null;
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

    const db = await getDb();

    const conditions = [eq(schema.notifications.userId, userId)];
    if (type) {
      conditions.push(eq(schema.notifications.type, type));
    }
    if (unread) {
      conditions.push(eq(schema.notifications.isRead, false));
    }
    if (after) {
      conditions.push(lt(schema.notifications.createdAt, new Date(after)));
    }

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: schema.notifications.id,
          type: schema.notifications.type,
          payload: schema.notifications.payload,
          title: schema.notifications.title,
          body: schema.notifications.body,
          metadata: schema.notifications.metadata,
          isRead: schema.notifications.isRead,
          createdAt: schema.notifications.createdAt,
        })
        .from(schema.notifications)
        .where(and(...conditions))
        .orderBy(desc(schema.notifications.createdAt))
        .limit(limit),
      db
        .select({ count: drizzleCount() })
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.userId, userId),
            eq(schema.notifications.isRead, false)
          )
        ),
    ]);

    const notifications: Notification[] = rows.map((row) => ({
      id: row.id,
      type: row.type,
      payload: row.payload as Record<string, unknown> | null,
      title: row.title,
      body: row.body,
      metadata: row.metadata as Record<string, unknown> | null,
      isRead: row.isRead,
      createdAt: (row.createdAt as unknown as Date).toISOString
        ? (row.createdAt as unknown as Date).toISOString()
        : (row.createdAt as unknown as string),
      actionUrl: deriveNotificationActionUrl(row.type, row.metadata as Record<string, unknown> | null),
    }));

    const unreadCount = countResult[0]?.count ?? 0;
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
