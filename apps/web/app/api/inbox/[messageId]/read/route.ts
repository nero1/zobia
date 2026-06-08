export const dynamic = 'force-dynamic';

/**
 * app/api/inbox/[messageId]/read/route.ts
 *
 * POST /api/inbox/[messageId]/read — Mark an admin message as read.
 *
 * Idempotent — calling this on an already-read message returns 200.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// POST /api/inbox/[messageId]/read
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

      const { rows } = await db.query<{
        read_at: string;
      }>(
        `UPDATE admin_message_receipts
         SET read_at = COALESCE(read_at, NOW()),
             delivered_at = COALESCE(delivered_at, NOW())
         WHERE message_id = $1
           AND recipient_id = $2
         RETURNING read_at`,
        [messageId, auth.user.sub]
      );

      if (!rows[0]) {
        throw notFound("Message not found in inbox");
      }

      return NextResponse.json({ ok: true, read_at: rows[0].read_at });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
