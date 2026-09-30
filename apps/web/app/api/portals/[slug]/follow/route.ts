export const dynamic = 'force-dynamic';

/**
 * app/api/portals/[slug]/follow/route.ts
 *
 * GET    /api/portals/<slug>/follow  -> { following }   (viewer state)
 * POST   /api/portals/<slug>/follow  -> follow a portal
 * DELETE /api/portals/<slug>/follow  -> unfollow
 *
 * Authenticated. The portal payload itself is viewer-independent and cached;
 * this is the only viewer-specific read on a portal page.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";
import { followPortal, isFollowingPortal, resolvePortal, unfollowPortal } from "@/lib/portals/repo";
import { invalidatePortalCache } from "@/lib/portals/cache";

async function portalFor(slug: string) {
  const resolved = await resolvePortal(slug);
  if (!resolved) throw notFound("Portal not found");
  return resolved;
}

export const GET = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    await requireFeatureEnabled("portals");
    const resolved = await portalFor(params.slug);
    const following = await isFollowingPortal(resolved.row.id, auth.user.sub);
    return NextResponse.json({ success: true, data: { following, portalId: resolved.row.id }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    await requireFeatureEnabled("portals");
    const resolved = await portalFor(params.slug);
    const result = await followPortal(resolved.row.id, auth.user.sub);
    await invalidatePortalCache(resolved.row.id);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ slug: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    await requireFeatureEnabled("portals");
    const resolved = await portalFor(params.slug);
    const result = await unfollowPortal(resolved.row.id, auth.user.sub);
    await invalidatePortalCache(resolved.row.id);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
