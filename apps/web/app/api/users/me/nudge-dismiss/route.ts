export const dynamic = 'force-dynamic';

/**
 * app/api/users/me/nudge-dismiss/route.ts
 *
 * POST /api/users/me/nudge-dismiss
 *
 * Records that the user has dismissed the email nudge banner.
 * Sets nudge_email_dismissed_at = NOW() on the user's record.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

    const db = await getDb();
    await db
      .update(schema.users)
      .set({ nudgeEmailDismissedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.users.id, auth.user.sub), isNull(schema.users.deletedAt)));

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
