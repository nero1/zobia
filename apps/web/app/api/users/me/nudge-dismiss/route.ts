/**
 * app/api/users/me/nudge-dismiss/route.ts
 *
 * POST /api/users/me/nudge-dismiss
 *
 * Records that the user has dismissed the email nudge banner.
 * Sets nudge_email_dismissed_at = NOW() on the user's record.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

/**
 * POST /api/users/me/nudge-dismiss
 *
 * @returns JSON { success: true }
 */
export const POST = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    await db.query(
      `UPDATE users
       SET nudge_email_dismissed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`,
      [auth.user.sub]
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
