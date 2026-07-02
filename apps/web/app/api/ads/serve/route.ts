export const dynamic = 'force-dynamic';

/**
 * app/api/ads/serve/route.ts
 *
 * GET /api/ads/serve?placement=<key> — serve one eligible ad for a
 * placement to the authenticated caller (components/ads/AdSlot.tsx,
 * components/ads/InStreamAd.tsx, etc.). Plan-based ad exposure and budget
 * eligibility are enforced server-side (lib/ads/serve.ts); the client is
 * responsible for offline-friendly frequency capping via localStorage.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth, type AuthContext } from "@/lib/api/middleware";
import { requireFeatureEnabled } from "@/lib/manifest";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { serveAd } from "@/lib/ads/serve";

export const GET = withAuth(async (req: NextRequest, { auth }: { auth: AuthContext }) => {
  try {
    await requireFeatureEnabled("nativeAds");
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const placement = req.nextUrl.searchParams.get("placement");
    if (!placement) throw badRequest("placement query param is required");

    const { rows } = await db.query<{ plan: string }>(
      `SELECT plan FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [auth.user.sub]
    );
    const plan = rows[0]?.plan ?? "free";

    const ad = await serveAd(placement, plan);
    return NextResponse.json({ success: true, data: { ad }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
