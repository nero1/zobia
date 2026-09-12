export const dynamic = 'force-dynamic';

/**
 * app/api/feed/route.ts
 *
 * GET /api/feed?tab=for_you|trending|friends|new&cursor=<opaque>&limit=20
 *
 * Returns a FeedPage. Auth required — the session user drives personalization
 * (interest re-ranking on for_you) and the friends tab's friend/follow graph.
 *
 * Scalability: for_you/trending are served from a precomputed candidate pool
 * (lib/feed/cache.ts, refreshed by /api/cron/feed-refresh every 10-15 min) —
 * a page request does at most one small Redis read + one small user_interests
 * read, never a cross-table aggregation. friends/new run a single bounded,
 * indexed UNION query per request (see lib/feed/aggregator.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";
import { fetchFeedPage } from "@/lib/feed/aggregator";
import type { FeedTab } from "@/lib/feed/types";

const VALID_TABS: FeedTab[] = ["for_you", "trending", "friends", "new"];

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const params = req.nextUrl.searchParams;
    const tabParam = params.get("tab") ?? "for_you";
    if (!VALID_TABS.includes(tabParam as FeedTab)) {
      throw badRequest(`Invalid tab '${tabParam}'. Must be one of: ${VALID_TABS.join(", ")}`, "INVALID_FEED_TAB");
    }
    const tab = tabParam as FeedTab;
    const cursor = params.get("cursor");

    const manifest = await loadManifest();
    const requestedLimit = parseInt(params.get("limit") ?? "", 10);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 50)
      : manifest.homeFeed.pageSize;

    const page = await fetchFeedPage(tab, auth.user.sub, cursor, limit);
    return NextResponse.json({ success: true, data: page, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
