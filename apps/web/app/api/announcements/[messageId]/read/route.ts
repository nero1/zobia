export const dynamic = 'force-dynamic';

/**
 * app/api/announcements/[messageId]/read/route.ts
 *
 * POST /api/announcements/[messageId]/read — Mark an admin message as read.
 *
 * Idempotent — calling this on an already-read message returns 200.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb, schema } from "@/lib/db/drizzle";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// POST /api/announcements/[messageId]/read
// ---------------------------------------------------------------------------

/**
 * Mark an admin message receipt as read for the current user.
 *
 * Only updates if the receipt exists and belongs to the authenticated user.
 * Does not update if already read (preserves original read_at timestamp).
 *
 * @returns { ok: true, read_at } or 404 if receipt not found
 */
export const POST = withAuth(
  async (
    req: NextRequest,
    {
      auth,
      params,
    }: { auth: { user: { sub: string } }; params: { messageId: string } }
  ) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

      const { messageId } = params;

      // NOTE: `messageId` here is the admin_message_receipts row's own `id`
      // (what GET /api/announcements returns as `id` and the client tracks per-item),
      // not `admin_message_id` — each user has their own receipt row per
      // broadcast message, so scoping by receipt id + user_id is both
      // correct and redundant-safe (a receipt can only belong to one user).
      const orm = await getDb();
      const rows = await orm
        .update(schema.adminMessageReceipts)
        .set({
          readAt: sql`COALESCE(${schema.adminMessageReceipts.readAt}, NOW())`,
          deliveredAt: sql`COALESCE(${schema.adminMessageReceipts.deliveredAt}, NOW())`,
        })
        .where(
          and(
            eq(schema.adminMessageReceipts.id, messageId),
            eq(schema.adminMessageReceipts.userId, auth.user.sub)
          )
        )
        .returning({ readAt: schema.adminMessageReceipts.readAt });

      if (!rows[0]) {
        throw notFound("Message not found in inbox");
      }

      return NextResponse.json({ ok: true, read_at: rows[0].readAt });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
