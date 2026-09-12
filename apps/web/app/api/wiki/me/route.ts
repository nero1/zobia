export const dynamic = "force-dynamic";

/**
 * app/api/wiki/me/route.ts
 *
 * GET /api/wiki/me — wikis the caller owns, plus wikis they actively
 * collaborate on (for the "My Wikis" dashboard entry point).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getWikisOwnedBy, getWikisContributedTo } from "@/lib/wiki/repo";

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const [owned, contributing] = await Promise.all([
      getWikisOwnedBy(auth.user.sub),
      getWikisContributedTo(auth.user.sub),
    ]);
    return NextResponse.json({ success: true, data: { owned, contributing }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
