export const dynamic = 'force-dynamic';

/**
 * app/api/public/portals/[slug]/route.ts
 *
 * GET /api/public/portals/<slug>
 *
 * The full (viewer-independent) portal payload, served from the two-tier
 * cache in lib/portals/cache.ts. `canonicalSlug` differs from the requested
 * slug when the tag was merged into another; clients should follow it.
 */

import { NextRequest, NextResponse } from "next/server";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { resolvePortal } from "@/lib/portals/repo";
import { getPortalPayload } from "@/lib/portals/page";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }): Promise<NextResponse> {
  try {
    await enforceRateLimit(getClientIp(req), "ip", RATE_LIMITS.apiRead);
    await requireFeatureEnabled("portals");
    const { slug } = await params;
    const resolved = await resolvePortal(slug);
    if (!resolved) throw notFound("Portal not found");
    const payload = await getPortalPayload(resolved.row);
    return NextResponse.json(
      { success: true, data: { ...payload, canonicalSlug: resolved.canonicalSlug }, error: null },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
