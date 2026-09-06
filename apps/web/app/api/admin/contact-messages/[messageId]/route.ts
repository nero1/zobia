export const dynamic = "force-dynamic";

/**
 * app/api/admin/contact-messages/[messageId]/route.ts
 *
 * PATCH /api/admin/contact-messages/<messageId> — mark a site contact
 * message read. Mirrors app/api/blogs/[slug]/messages/[messageId]/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { markSiteContactMessageRead } from "@/lib/contact/service";
import { logger } from "@/lib/logger";

export const PATCH = withAdminAuth<{ messageId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    await markSiteContactMessageRead(params.messageId);
    return NextResponse.json({ success: true, data: { updated: true }, error: null });
  } catch (err) {
    logger.error({ err, messageId: params.messageId }, "[admin/contact-messages] failed to mark message read");
    return handleApiError(err);
  }
});
