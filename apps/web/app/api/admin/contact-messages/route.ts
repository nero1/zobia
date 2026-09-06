export const dynamic = "force-dynamic";

/**
 * app/api/admin/contact-messages/route.ts
 *
 * GET /api/admin/contact-messages — the platform-level inbox for the
 * site-wide Contact Us page (app/contact), read by any admin. Mirrors
 * app/api/blogs/[slug]/messages/route.ts's per-blog contact inbox, except
 * there's no single owner to scope to — any confirmed admin can read every
 * message (see lib/contact/service.ts listSiteContactMessages).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { listSiteContactMessages } from "@/lib/contact/service";
import { logger } from "@/lib/logger";

export const GET = withAdminAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const messages = await listSiteContactMessages();
    return NextResponse.json({ success: true, data: { messages }, error: null });
  } catch (err) {
    logger.error({ err }, "[admin/contact-messages] failed to list site contact messages");
    return handleApiError(err);
  }
});
