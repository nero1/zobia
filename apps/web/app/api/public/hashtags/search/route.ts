export const dynamic = 'force-dynamic';

/**
 * app/api/public/hashtags/search/route.ts
 *
 * GET /api/public/hashtags/search?q=<prefix>&limit=10
 *
 * Tag autocomplete for composers ("#la" -> lagos, lasu) and the search page.
 * Canonical, non-blocked tags only; `hasPortal` tells the client whether the
 * tag links to a live portal.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { searchHashtags } from "@/lib/hashtags/service";

const querySchema = z.object({
  q: z.string().trim().max(50).default(""),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await enforceRateLimit(getClientIp(req), "ip", RATE_LIMITS.apiRead);
    await requireFeatureEnabled("portals");
    const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) throw badRequest("Invalid query", { issues: parsed.error.issues });
    const tags = await searchHashtags(parsed.data.q, parsed.data.limit);
    return NextResponse.json(
      { success: true, data: { hashtags: tags }, error: null },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
