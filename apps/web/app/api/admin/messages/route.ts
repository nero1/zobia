export const dynamic = 'force-dynamic';

/**
 * app/api/admin/messages/route.ts
 *
 * POST /api/admin/messages — Send an admin message to users.
 * GET  /api/admin/messages — List sent admin messages with delivery stats.
 *
 * Broadcast types:
 *  - direct       → specific user IDs (targetUserIds)
 *  - all          → every non-banned user
 *  - by_plan      → users on specific subscription plans (targetPlans)
 *  - by_role      → users with specific roles (targetRoles)
 *
 * Admin messages are exempt from DM coin costs and daily limits.
 * Telegram delivery is fire-and-forget.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const SendMessageSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
  broadcastType: z.enum(["direct", "all", "by_plan", "by_role"]),
  targetUserIds: z.array(z.string().uuid()).optional(),
  targetPlans: z.array(z.string()).optional(),
  targetRoles: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the list of recipient user IDs and their Telegram IDs (if any)
 * based on the broadcast type and targeting parameters.
 */
async function resolveRecipients(
  broadcastType: string,
  targetUserIds?: string[],
  targetPlans?: string[],
  targetRoles?: string[]
): Promise<Array<{ id: string; telegram_id: string | null }>> {
  switch (broadcastType) {
    case "direct": {
      if (!targetUserIds?.length) return [];
      const placeholders = targetUserIds.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await db.query<{ id: string; telegram_id: string | null }>(
        `SELECT id, telegram_id FROM users
         WHERE id IN (${placeholders})
           AND is_banned = false
           AND deleted_at IS NULL`,
        targetUserIds
      );
      return rows;
    }
    case "all": {
      const { rows } = await db.query<{ id: string; telegram_id: string | null }>(
        `SELECT id, telegram_id FROM users
         WHERE is_banned = false AND deleted_at IS NULL`
      );
      return rows;
    }
    case "by_plan": {
      if (!targetPlans?.length) return [];
      const placeholders = targetPlans.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await db.query<{ id: string; telegram_id: string | null }>(
        `SELECT u.id, u.telegram_id FROM users u
         JOIN user_subscriptions s ON s.user_id = u.id
         WHERE s.plan_id IN (${placeholders})
           AND s.status = 'active'
           AND u.is_banned = false
           AND u.deleted_at IS NULL`,
        targetPlans
      );
      return rows;
    }
    case "by_role": {
      if (!targetRoles?.length) return [];
      const placeholders = targetRoles.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await db.query<{ id: string; telegram_id: string | null }>(
        `SELECT u.id, u.telegram_id FROM users u
         JOIN user_roles r ON r.user_id = u.id
         WHERE r.role IN (${placeholders})
           AND u.is_banned = false
           AND u.deleted_at IS NULL`,
        targetRoles
      );
      return rows;
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/messages
// ---------------------------------------------------------------------------

/**
 * Send an admin message to one or more users.
 *
 * Creates an admin_messages record and bulk-inserts admin_message_receipts
 * for all resolved recipients. Telegram-linked users receive a notification
 * asynchronously (fire-and-forget).
 *
 * @returns { messageId, recipientCount }
 */
export const POST = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await req.json().catch(() => ({}));
    const parsed = SendMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest("Invalid message payload", parsed.error.flatten());
    }

    const { subject, body: msgBody, broadcastType, targetUserIds, targetPlans, targetRoles } =
      parsed.data;

    // Resolve recipients
    const recipients = await resolveRecipients(
      broadcastType,
      targetUserIds,
      targetPlans,
      targetRoles
    );

    if (recipients.length === 0) {
      throw badRequest("No recipients found for the given targeting criteria");
    }

    // Insert admin message record
    const { rows: msgRows } = await db.query<{ id: string }>(
      `INSERT INTO admin_messages
         (sender_admin_id, subject, body, broadcast_type, recipient_count, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id`,
      [auth.user.sub, subject, msgBody, broadcastType, recipients.length]
    );

    const messageId = msgRows[0]?.id;
    if (!messageId) {
      throw new Error("Failed to create admin message record");
    }

    // Bulk insert receipts
    // Build VALUES clause in chunks of 500 to avoid hitting DB limits
    const CHUNK_SIZE = 500;
    for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
      const chunk = recipients.slice(i, i + CHUNK_SIZE);
      const values: string[] = [];
      const params: string[] = [];
      let paramIdx = 1;

      for (const recipient of chunk) {
        values.push(`($${paramIdx}, $${paramIdx + 1}, NOW())`);
        params.push(messageId, recipient.id);
        paramIdx += 2;
      }

      await db.query(
        `INSERT INTO admin_message_receipts
           (admin_message_id, user_id, delivered_at)
         VALUES ${values.join(", ")}
         ON CONFLICT (admin_message_id, user_id) DO NOTHING`,
        params
      );
    }

    // Enqueue Telegram delivery — the queue worker picks this up with retry logic
    const telegramRecipients = recipients.filter((r) => r.telegram_id);
    if (telegramRecipients.length > 0) {
      await db
        .query(
          `INSERT INTO telegram_delivery_queue
             (broadcast_id, telegram_ids)
           VALUES ($1, $2)`,
          [
            messageId,
            JSON.stringify(telegramRecipients.map((r) => r.telegram_id)),
          ]
        )
        .catch((err) =>
          console.error("[admin/messages] Telegram queue enqueue failed:", err)
        );
    }

    return NextResponse.json({ messageId, recipientCount: recipients.length });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/messages
// ---------------------------------------------------------------------------

/**
 * List all sent admin messages with delivery statistics.
 *
 * @returns Paginated list of messages with read/delivered counts
 */
export const GET = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
    const offset = parseInt(url.searchParams.get("offset") ?? "0");

    const { rows } = await db.query<{
      id: string;
      sender_id: string;
      sender_username: string;
      subject: string;
      broadcast_type: string;
      recipient_count: number;
      delivered_count: number;
      read_count: number;
      created_at: string;
    }>(
      `SELECT
         m.id,
         m.sender_admin_id,
         u.username AS sender_username,
         m.subject,
         m.broadcast_type,
         m.recipient_count,
         COUNT(r.id) FILTER (WHERE r.delivered_at IS NOT NULL)::int AS delivered_count,
         COUNT(r.id) FILTER (WHERE r.read_at IS NOT NULL)::int      AS read_count,
         m.created_at
       FROM admin_messages m
       LEFT JOIN users u  ON u.id = m.sender_admin_id
       LEFT JOIN admin_message_receipts r ON r.admin_message_id = m.id
       GROUP BY m.id, u.username
       ORDER BY m.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return NextResponse.json({ items: rows, limit, offset });
  } catch (err) {
    return handleApiError(err);
  }
});
