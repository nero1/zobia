/**
 * app/api/users/me/admin-messages/route.ts
 *
 * GET  /api/users/me/admin-messages  — list admin messages delivered to the current user
 * POST /api/users/me/admin-messages/read — mark a message as read (see [messageId]/read/route.ts)
 *
 * PRD §20: Admin can send direct/broadcast/plan-targeted/role-targeted messages.
 * This endpoint lets users retrieve and mark those messages as read.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// GET — list admin messages for the current user
// ---------------------------------------------------------------------------

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 50);
    const offset = parseInt(url.searchParams.get("offset") ?? "0");

    const { rows } = await db.query<{
      id: string;
      subject: string | null;
      body: string;
      broadcast_type: string;
      delivered_at: string | null;
      read_at: string | null;
      is_read: boolean;
      created_at: string;
    }>(
      `SELECT
         m.id,
         m.subject,
         m.body,
         m.broadcast_type,
         r.delivered_at,
         r.read_at,
         r.is_read,
         m.created_at
       FROM admin_message_receipts r
       JOIN admin_messages m ON m.id = r.admin_message_id
       WHERE r.user_id = $1
       ORDER BY m.created_at DESC
       LIMIT $2 OFFSET $3`,
      [auth.user.sub, limit, offset]
    );

    // Mark all fetched messages as delivered if not already
    const undelivered = rows.filter((r) => !r.delivered_at).map((r) => r.id);
    if (undelivered.length > 0) {
      await db.query(
        `UPDATE admin_message_receipts
         SET is_delivered = true, delivered_at = NOW()
         WHERE admin_message_id = ANY($1::uuid[])
           AND user_id = $2
           AND delivered_at IS NULL`,
        [undelivered, auth.user.sub]
      ).catch(() => {});
    }

    return NextResponse.json({ items: rows, limit, offset }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH — mark a specific message as read
// ---------------------------------------------------------------------------

export const PATCH = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = (await req.json().catch(() => ({}))) as { messageId?: string };
    if (!body.messageId) {
      return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    }

    await db.query(
      `UPDATE admin_message_receipts
       SET is_read = true, read_at = COALESCE(read_at, NOW())
       WHERE admin_message_id = $1 AND user_id = $2`,
      [body.messageId, auth.user.sub]
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
