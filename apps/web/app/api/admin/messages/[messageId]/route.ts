export const dynamic = 'force-dynamic';

/**
 * app/api/admin/messages/[messageId]/route.ts
 *
 * GET /api/admin/messages/[messageId] — Message detail with per-recipient
 * delivery and read status.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb } from "@/lib/db/drizzle";

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

      const orm = await getDb();

      // Message header
      const { rows: msgRows } = await orm.execute<{
        id: string;
        sender_admin_id: string;
        sender_username: string;
        subject: string;
        body: string;
        broadcast_type: string;
        recipient_count: number;
        created_at: string;
      }>(sql`
        SELECT
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
         WHERE m.id = ${messageId}
      `);

      const message = msgRows[0];
      if (!message) {
        throw notFound("Admin message not found");
      }

      const url = new URL(req.url);
      const limit = Math.min(
        parseInt(url.searchParams.get("limit") ?? "100"),
        500
      );
      const offset = parseInt(url.searchParams.get("offset") ?? "0");

      // Per-recipient status
      const { rows: receipts } = await orm.execute<{
        recipient_id: string;
        username: string | null;
        delivered_at: string | null;
        read_at: string | null;
      }>(sql`
        SELECT
           r.user_id AS recipient_id,
           u.username,
           r.delivered_at,
           r.read_at
         FROM admin_message_receipts r
         LEFT JOIN users u ON u.id = r.user_id
         WHERE r.admin_message_id = ${messageId}
         ORDER BY r.delivered_at DESC NULLS LAST
         LIMIT ${limit} OFFSET ${offset}
      `);

      const deliveredCount = receipts.filter((r) => r.delivered_at).length;

      return NextResponse.json({
        id: message.id,
        subject: message.subject ?? "(no subject)",
        bodyPreview: message.body ? message.body.slice(0, 140) : "",
        body: message.body,
        recipientMode: message.broadcast_type === "direct" ? "specific" : message.broadcast_type,
        recipientsCount: message.recipient_count ?? 0,
        deliveredCount,
        sentAt: message.created_at,
        senderUsername: message.sender_username ?? undefined,
        deliveries: receipts.map((r) => ({
          userId: r.recipient_id,
          username: r.username ?? "unknown",
          deliveredAt: r.delivered_at,
          readAt: r.read_at,
        })),
        limit,
        offset,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
