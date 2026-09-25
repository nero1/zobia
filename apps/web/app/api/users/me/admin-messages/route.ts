export const dynamic = 'force-dynamic';

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
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// GET — list admin messages for the current user
// ---------------------------------------------------------------------------

export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 50);
    const offset = parseInt(url.searchParams.get("offset") ?? "0");

    const db = await getDb();
    const rows = await db
      .select({
        id: schema.adminMessages.id,
        subject: schema.adminMessages.subject,
        body: schema.adminMessages.body,
        broadcast_type: schema.adminMessages.broadcastType,
        delivered_at: schema.adminMessageReceipts.deliveredAt,
        read_at: schema.adminMessageReceipts.readAt,
        is_read: schema.adminMessageReceipts.isRead,
        created_at: schema.adminMessages.createdAt,
      })
      .from(schema.adminMessageReceipts)
      .innerJoin(
        schema.adminMessages,
        eq(schema.adminMessages.id, schema.adminMessageReceipts.adminMessageId)
      )
      .where(eq(schema.adminMessageReceipts.userId, auth.user.sub))
      .orderBy(desc(schema.adminMessages.createdAt))
      .limit(limit)
      .offset(offset);

    // Mark all fetched messages as delivered if not already
    const undelivered = rows.filter((r) => !r.delivered_at).map((r) => r.id);
    if (undelivered.length > 0) {
      await db
        .update(schema.adminMessageReceipts)
        .set({ isDelivered: true, deliveredAt: new Date() })
        .where(
          and(
            inArray(schema.adminMessageReceipts.adminMessageId, undelivered),
            eq(schema.adminMessageReceipts.userId, auth.user.sub),
            isNull(schema.adminMessageReceipts.deliveredAt)
          )
        )
        .catch(() => {});
    }

    return NextResponse.json({ items: rows, limit, offset }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH — mark a specific message as read
// ---------------------------------------------------------------------------

export const PATCH = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = (await req.json().catch(() => ({}))) as { messageId?: string };
    if (!body.messageId) {
      return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    }

    const db = await getDb();
    await db
      .update(schema.adminMessageReceipts)
      .set({ isRead: true, readAt: sql`COALESCE(${schema.adminMessageReceipts.readAt}, NOW())` })
      .where(
        and(
          eq(schema.adminMessageReceipts.adminMessageId, body.messageId),
          eq(schema.adminMessageReceipts.userId, auth.user.sub)
        )
      );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
