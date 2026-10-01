export const dynamic = 'force-dynamic';

/**
 * app/api/ads/serve/route.ts
 *
 * GET /api/ads/serve?placement=<key>            -> { ad }
 * GET /api/ads/serve?placements=<k1>,<k2>,...   -> { ads: { [key]: ad | null } }
 *
 * Serves eligible ads to the authenticated caller. Plan-based ad exposure
 * and budget eligibility are enforced server-side (lib/ads/serve.ts); the
 * client is responsible for offline-friendly frequency capping via
 * localStorage.
 *
 * The batch form exists because every request is billed Vercel Active CPU:
 * a page with several slots (home has two, feeds more) now costs one request
 * instead of one per slot (lib/ads/clientServe.ts batches the slots that
 * mount together). When the native-ads feature is off this answers 200 with
 * no ads rather than an error, so clients can cache "nothing to show"
 * instead of retrying a 503 on every mount.
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db/drizzle";
import { and, eq, isNull } from "drizzle-orm";
import { withAuth, type AuthContext } from "@/lib/api/middleware";
import { loadManifest } from "@/lib/manifest";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { serveAd, type ServedAd } from "@/lib/ads/serve";

const MAX_PLACEMENTS = 10;
const PLACEMENT_RE = /^[a-z0-9_]{1,64}$/;

export const GET = withAuth(async (req: NextRequest, { auth }: { auth: AuthContext }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const params = req.nextUrl.searchParams;
    const single = params.get("placement");
    const batch = params.get("placements");
    const placements = Array.from(
      new Set((batch ?? single ?? "").split(",").map((p) => p.trim()).filter(Boolean))
    );
    if (placements.length === 0) throw badRequest("placement query param is required");
    if (placements.length > MAX_PLACEMENTS) throw badRequest(`At most ${MAX_PLACEMENTS} placements per request`);
    if (!placements.every((p) => PLACEMENT_RE.test(p))) throw badRequest("invalid placement key");

    const manifest = await loadManifest();
    let ads: Record<string, ServedAd | null> = Object.fromEntries(placements.map((p) => [p, null]));

    if (manifest.features.nativeAds) {
      const orm = await getDb();
      const rows = await orm
        .select({ plan: schema.users.plan })
        .from(schema.users)
        .where(and(eq(schema.users.id, auth.user.sub), isNull(schema.users.deletedAt)))
        .limit(1);
      const plan = rows[0]?.plan ?? "free";
      const served = await Promise.all(placements.map((p) => serveAd(p, plan)));
      ads = Object.fromEntries(placements.map((p, i) => [p, served[i]]));
    }

    const data = batch !== null ? { ads } : { ad: ads[placements[0]] ?? null };
    return NextResponse.json({ success: true, data, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
