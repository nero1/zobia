export const dynamic = 'force-dynamic';

/**
 * app/api/public/portals/discover/route.ts
 *
 * GET /api/public/portals/discover
 *
 * The whole /h discovery hub in one cached payload: featured, trending
 * hashtags, rising, places & schools, newest and popular portals.
 * (A portal can never be called "discover": it is a reserved slug.)
 */

import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { getDiscoverPayload } from "@/lib/portals/discover";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await enforceRateLimit(getClientIp(req), "ip", RATE_LIMITS.apiRead);
    await requireFeatureEnabled("portals");
    const data = await getDiscoverPayload();
    return NextResponse.json(
      { success: true, data, error: null },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
