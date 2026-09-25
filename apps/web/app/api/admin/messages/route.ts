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
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb, schema } from "@/lib/db/drizzle";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const SendMessageSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
  broadcastType: z.enum(["direct", "all", "by_plan", "by_role"]),
  targetUserIds: z.array(z.string().uuid()).max(1000, "Cannot target more than 1000 users at once").optional(),
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
  orm: Awaited<ReturnType<typeof getDb>>,
  broadcastType: string,
  targetUserIds?: string[],
  targetPlans?: string[],
  targetRoles?: string[]
): Promise<Array<{ id: string; telegram_id: string | null }>> {
  switch (broadcastType) {
    case "direct": {
      if (!targetUserIds?.length) return [];
      const rows = await orm
        .select({ id: schema.users.id, telegram_id: schema.users.telegramId })
        .from(schema.users)
        .where(
          and(
            inArray(schema.users.id, targetUserIds),
            sql`COALESCE(${schema.users.isBanned}, false) = false`,
            isNull(schema.users.deletedAt)
          )
        );
      return rows;
    }
    case "all": {
      const rows = await orm
        .select({ id: schema.users.id, telegram_id: schema.users.telegramId })
        .from(schema.users)
        .where(and(sql`COALESCE(${schema.users.isBanned}, false) = false`, isNull(schema.users.deletedAt)));
      return rows;
    }
    case "by_plan": {
      if (!targetPlans?.length) return [];
      // BUG-FIX: the pre-migration raw SQL filtered on a non-existent
      // `user_subscriptions.plan_id` column, so this branch always returned
      // zero recipients. `users.plan` (not the `subscriptions` billing-period
      // table) is the canonical current-entitlement field used everywhere
      // else in the codebase (see lib/plans/subscriptionSweep.ts) — it also
      // covers admin/promo-granted plans that have no row in `subscriptions`.
      const rows = await orm
        .select({ id: schema.users.id, telegram_id: schema.users.telegramId })
        .from(schema.users)
        .where(
          and(
            inArray(schema.users.plan, targetPlans),
            sql`COALESCE(${schema.users.isBanned}, false) = false`,
            isNull(schema.users.deletedAt)
          )
        );
      return rows;
    }
    case "by_role": {
      if (!targetRoles?.length) return [];
      const rows = await orm
        .selectDistinct({ id: schema.users.id, telegram_id: schema.users.telegramId })
        .from(schema.users)
        .innerJoin(schema.adminRoles, eq(schema.adminRoles.userId, schema.users.id))
        .where(
          and(
            inArray(schema.adminRoles.role, targetRoles),
            sql`COALESCE(${schema.users.isBanned}, false) = false`,
            isNull(schema.users.deletedAt)
          )
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

    const orm = await getDb();

    // Resolve recipients
    const recipients = await resolveRecipients(
      orm,
      broadcastType,
      targetUserIds,
      targetPlans,
      targetRoles
    );

    if (recipients.length === 0) {
      throw badRequest("No recipients found for the given targeting criteria");
    }

    // Insert admin message record
    const [created] = await orm
      .insert(schema.adminMessages)
      .values({
        senderAdminId: auth.user.sub,
        subject,
        body: msgBody,
        broadcastType,
        recipientCount: recipients.length,
      })
      .returning({ id: schema.adminMessages.id });

    const messageId = created?.id;
    if (!messageId) {
      throw new Error("Failed to create admin message record");
    }

    // Bulk insert receipts
    // Build in chunks of 500 to avoid hitting DB limits
    const CHUNK_SIZE = 500;
    for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
      const chunk = recipients.slice(i, i + CHUNK_SIZE);
      await orm
        .insert(schema.adminMessageReceipts)
        .values(chunk.map((r) => ({ adminMessageId: messageId, userId: r.id, deliveredAt: new Date() })))
        .onConflictDoNothing();
    }

    // Enqueue Telegram delivery — the queue worker picks this up with retry logic
    const telegramRecipients = recipients.filter((r) => r.telegram_id);
    if (telegramRecipients.length > 0) {
      await orm
        .insert(schema.telegramDeliveryQueue)
        .values({
          broadcastId: messageId,
          telegramIds: telegramRecipients.map((r) => r.telegram_id),
        })
        .catch((err) => {
          logger.error({ err: err }, "[admin/messages] Telegram queue enqueue failed:");
        });
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

    const orm = await getDb();
    const rows = await orm
      .select({
        id: schema.adminMessages.id,
        senderAdminId: schema.adminMessages.senderAdminId,
        senderUsername: schema.users.username,
        subject: schema.adminMessages.subject,
        body: schema.adminMessages.body,
        broadcastType: schema.adminMessages.broadcastType,
        recipientCount: schema.adminMessages.recipientCount,
        deliveredCount: sql<number>`COUNT(${schema.adminMessageReceipts.id}) FILTER (WHERE ${schema.adminMessageReceipts.deliveredAt} IS NOT NULL)::int`,
        readCount: sql<number>`COUNT(${schema.adminMessageReceipts.id}) FILTER (WHERE ${schema.adminMessageReceipts.readAt} IS NOT NULL)::int`,
        createdAt: schema.adminMessages.createdAt,
      })
      .from(schema.adminMessages)
      .leftJoin(schema.users, eq(schema.users.id, schema.adminMessages.senderAdminId))
      .leftJoin(schema.adminMessageReceipts, eq(schema.adminMessageReceipts.adminMessageId, schema.adminMessages.id))
      .groupBy(schema.adminMessages.id, schema.users.username)
      .orderBy(desc(schema.adminMessages.createdAt))
      .limit(limit)
      .offset(offset);

    const items = rows.map((r) => ({
      id: r.id,
      subject: r.subject ?? "(no subject)",
      bodyPreview: r.body ? r.body.slice(0, 140) : "",
      recipientMode: r.broadcastType === "direct" ? "specific" : r.broadcastType,
      recipientsCount: r.recipientCount ?? 0,
      deliveredCount: r.deliveredCount ?? 0,
      readCount: r.readCount ?? 0,
      senderUsername: r.senderUsername ?? undefined,
      sentAt: r.createdAt,
    }));

    return NextResponse.json({ items, limit, offset });
  } catch (err) {
    return handleApiError(err);
  }
});
