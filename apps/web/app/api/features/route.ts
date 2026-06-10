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
import { loadManifest, getManifestValue } from "@/lib/manifest";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const manifest = await loadManifest();

    // Check raw values for keys that may not be seeded yet (permissive defaults)
    const [twoFaRaw, twoFaModsRaw] = await Promise.all([
      getManifestValue("auth_2fa_enabled"),
      getManifestValue("auth_2fa_required_for_mods"),
    ]);

    return NextResponse.json(
      {
        twoFaEnabled: twoFaRaw !== "false", // default: enabled
        pinEnabled: manifest.features.pinAuth,
        twoFaRequiredForMods: twoFaModsRaw === "true", // default: disabled
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
