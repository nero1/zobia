export const dynamic = 'force-dynamic';

/**
 * app/api/public/portals/[slug]/view/route.ts
 *
 * POST /api/public/portals/<slug>/view  { src?: "feed" | "search" | "direct" }
 *
 * Records one portal page view (and a click when it came from a feed
 * suggestion card) in portal_stats_daily. The client dedupes per day via
 * localStorage (components/portals/PortalViewTracker.tsx); this endpoint adds
 * an in-process IP throttle so a script cannot inflate the counters.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, type RateLimitOptions } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { bumpPortalStat, resolvePortal } from "@/lib/portals/repo";

const VIEW_LIMIT: RateLimitOptions = { limit: 40, windowMs: 60_000, name: "portal:view", tier: "local" };
const bodySchema = z.object({ src: z.enum(["feed", "search", "direct"]).default("direct") }).default({ src: "direct" });

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }): Promise<NextResponse> {
  try {
    await enforceRateLimit(getClientIp(req), "ip", VIEW_LIMIT);
    await requireFeatureEnabled("portals");
    const raw = await req.json().catch(() => ({}));
    const { src } = bodySchema.parse(raw);

    const { slug } = await params;
    const resolved = await resolvePortal(slug);
    if (!resolved) throw notFound("Portal not found");

    await bumpPortalStat(resolved.row.id, "views");
    if (src === "feed") await bumpPortalStat(resolved.row.id, "clicks");
    return NextResponse.json({ success: true, data: { recorded: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
}
