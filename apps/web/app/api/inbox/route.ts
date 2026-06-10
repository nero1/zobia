export const dynamic = 'force-dynamic';

/**
 * app/api/inbox/route.ts
 *
 * GET /api/inbox — User's admin message inbox.
 *
 * Returns admin messages addressed to the current user, ordered newest
 * first. Marks returned messages as delivered (sets delivered_at if not
 * already set).
 *
 * Admin messages do NOT count toward DM coin costs or daily limits.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// GET /api/inbox
// ---------------------------------------------------------------------------

/**
 * Return the admin message inbox for the authenticated user.
 *
 * Marks all returned (undelivered) messages as delivered in the same
 * database call using a CTE.
 *
 * @returns Paginated list of admin messages with read status
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
    const offset = parseInt(url.searchParams.get("offset") ?? "0");

    // Fetch messages and mark undelivered ones as delivered atomically.
    // Column names match the actual DB schema: admin_message_id + user_id.
    const { rows } = await db.query<{
      id: string;
      admin_message_id: string;
      subject: string;
      body: string;
      broadcast_type: string;
      sender_username: string;
      delivered_at: string | null;
      read_at: string | null;
      created_at: string;
    }>(
      `WITH updated AS (
         UPDATE admin_message_receipts
         SET delivered_at = NOW()
         WHERE admin_message_id IN (
           SELECT r2.admin_message_id
           FROM admin_message_receipts r2
           WHERE r2.user_id = $1
             AND r2.delivered_at IS NULL
         )
         AND user_id = $1
       )
       SELECT
         r.id,
         r.admin_message_id,
         m.subject,
         m.body,
         m.broadcast_type,
         'Zobia Team' AS sender_username,
         r.delivered_at,
         r.read_at,
         m.created_at
       FROM admin_message_receipts r
       JOIN admin_messages m ON m.id = r.admin_message_id
       WHERE r.user_id = $1
       ORDER BY m.created_at DESC
       LIMIT $2 OFFSET $3`,
      [auth.user.sub, limit, offset]
    );

    const unreadCount = rows.filter((r) => !r.read_at).length;

    return NextResponse.json({
      items: rows,
      unread_count: unreadCount,
      limit,
      offset,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
