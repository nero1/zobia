/**
 * app/api/admin/messages/[messageId]/route.ts
 *
 * GET /api/admin/messages/[messageId] — Message detail with per-recipient
 * delivery and read status.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// GET /api/admin/messages/[messageId]
// ---------------------------------------------------------------------------

/**
 * Fetch a single admin message with full per-recipient delivery and
 * read status. Paginated via offset for large recipient lists.
 *
 * @returns Message header + paginated recipient list
 */
export const GET = withAdminAuth(
  async (
    req: NextRequest,
    {
      auth,
      params,
    }: { auth: { user: { sub: string } }; params: { messageId: string } }
  ) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

      const { messageId } = params;

      // Message header
      const { rows: msgRows } = await db.query<{
        id: string;
        sender_admin_id: string;
        sender_username: string;
        subject: string;
        body: string;
        broadcast_type: string;
        recipient_count: number;
        created_at: string;
      }>(
        `SELECT
           m.id,
           m.sender_admin_id,
           u.username AS sender_username,
           m.subject,
           m.body,
           m.broadcast_type,
           m.recipient_count,
           m.created_at
         FROM admin_messages m
         LEFT JOIN users u ON u.id = m.sender_admin_id
         WHERE m.id = $1`,
        [messageId]
      );

      const message = msgRows[0];
      if (!message) {
        return notFound("Admin message not found");
      }

      const url = new URL(req.url);
      const limit = Math.min(
        parseInt(url.searchParams.get("limit") ?? "100"),
        500
      );
      const offset = parseInt(url.searchParams.get("offset") ?? "0");

      // Per-recipient status
      const { rows: receipts } = await db.query<{
        recipient_id: string;
        username: string;
        delivered_at: string | null;
        read_at: string | null;
      }>(
        `SELECT
           r.user_id AS recipient_id,
           u.username,
           r.delivered_at,
           r.read_at
         FROM admin_message_receipts r
         LEFT JOIN users u ON u.id = r.user_id
         WHERE r.admin_message_id = $1
         ORDER BY r.delivered_at DESC NULLS LAST
         LIMIT $2 OFFSET $3`,
        [messageId, limit, offset]
      );

      return NextResponse.json({ message, receipts, limit, offset });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
