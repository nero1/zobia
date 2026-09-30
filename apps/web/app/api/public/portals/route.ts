export const dynamic = 'force-dynamic';

/**
 * app/api/public/portals/route.ts
 *
 * GET /api/public/portals?sort=trending|followers|new|boost&q=<text>&limit=24&offset=0
 *
 * Public discovery list of live portals (official + auto). No auth so the
 * Capacitor app, the PWA and crawlers can all read it; CDN-cached briefly.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest, requireFeatureEnabled } from "@/lib/manifest";
import { listPortals } from "@/lib/portals/repo";

const querySchema = z.object({
  sort: z.enum(["trending", "followers", "new", "boost"]).default("trending"),
  q: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await enforceRateLimit(getClientIp(req), "ip", RATE_LIMITS.apiRead);
    await requireFeatureEnabled("portals");
    const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) throw badRequest("Invalid query", { issues: parsed.error.issues });

    const manifest = await loadManifest();
    const { cards, total } = await listPortals(
      { statuses: ["official", "auto"], ...parsed.data },
      manifest.portals.trendingWindowHours
    );
    return NextResponse.json(
      { success: true, data: { portals: cards, total }, error: null },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
