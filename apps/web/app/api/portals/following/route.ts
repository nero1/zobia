export const dynamic = 'force-dynamic';

/**
 * app/api/portals/following/route.ts
 *
 * GET /api/portals/following -> the portals the signed-in user follows.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest, requireFeatureEnabled } from "@/lib/manifest";
import { listFollowedPortals } from "@/lib/portals/repo";

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    await requireFeatureEnabled("portals");
    const manifest = await loadManifest();
    const portals = await listFollowedPortals(auth.user.sub, manifest.portals.trendingWindowHours);
    return NextResponse.json({ success: true, data: { portals }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
