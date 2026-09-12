export const dynamic = "force-dynamic";

/**
 * app/api/admin/profile-themes/route.ts
 *
 * GET /api/admin/profile-themes — full theme catalog (including disabled rows).
 * Mirrors GET /api/admin/blogs/themes.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { listAllProfileThemes } from "@/lib/profile/themes";

export const GET = withAdminAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const themes = await listAllProfileThemes();
    return NextResponse.json({ success: true, data: { themes }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
