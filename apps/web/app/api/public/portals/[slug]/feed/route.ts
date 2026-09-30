export const dynamic = 'force-dynamic';

/**
 * app/api/public/portals/[slug]/feed/route.ts
 *
 * GET /api/public/portals/<slug>/feed?sort=top|new&cursor=<opaque>&limit=12
 *
 * Paged mini discovery feed for one portal (page 1 is already embedded in the
 * cached payload; this serves "load more" and the New tab).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { resolvePortal } from "@/lib/portals/repo";
import { fetchTaggedFeed } from "@/lib/portals/content";
import { resolveTagPage } from "@/lib/portals/tagPage";

const querySchema = z.object({
  sort: z.enum(["top", "new"]).default("top"),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(30).default(12),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }): Promise<NextResponse> {
  try {
    await enforceRateLimit(getClientIp(req), "ip", RATE_LIMITS.apiRead);
    await requireFeatureEnabled("portals");
    const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) throw badRequest("Invalid query", { issues: parsed.error.issues });

    const { slug } = await params;
    const resolved = await resolvePortal(slug);
    const tagPage = resolved ? null : await resolveTagPage(slug);
    const hashtagId = resolved?.hashtagId ?? tagPage?.hashtagId;
    if (!hashtagId) throw notFound("Portal not found");

    const page = await fetchTaggedFeed(hashtagId, parsed.data);
    return NextResponse.json(
      { success: true, data: page, error: null },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
