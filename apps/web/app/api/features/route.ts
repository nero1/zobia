export const dynamic = 'force-dynamic';

/**
 * GET /api/features
 *
 * Returns feature flags relevant to authenticated users.
 * Reads from x_manifest via the cached manifest loader.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { loadManifest } from "@/lib/manifest";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const manifest = await loadManifest();

    return NextResponse.json(
      {
        twoFaEnabled: manifest.features.twoFaEnabled,
        pinEnabled: manifest.features.pinAuth,
        twoFaRequiredForMods: manifest.features.twoFaRequiredForMods,
      },
      {
        status: 200,
        headers: { "Cache-Control": "private, max-age=300" },
      }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
