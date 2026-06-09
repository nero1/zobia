export const dynamic = 'force-dynamic';

/**
 * app/api/manifest/route.ts
 *
 * App manifest endpoints.
 *
 * GET /api/manifest
 *   Returns the x_manifest config with public-safe keys only (no secrets).
 *   Publicly accessible – no auth required.
 *
 * PUT /api/manifest/[key]  →  handled in ./[key]/route.ts
 *   Admin-only: updates a manifest value (requires is_admin DB check).
 */

import { NextRequest, NextResponse } from "next/server";
import { loadManifest } from "@/lib/manifest";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Public-safe manifest key allowlist
// ---------------------------------------------------------------------------

/**
 * Only these top-level manifest sections are exposed publicly.
 * Payment provider secrets and moderation internals are excluded.
 */
const PUBLIC_MANIFEST_SECTIONS = ["features", "payment"] as const;

type PublicManifestSection = (typeof PUBLIC_MANIFEST_SECTIONS)[number];

type PublicManifest = {
  [K in PublicManifestSection]: Awaited<ReturnType<typeof loadManifest>>[K];
} & {
  captchaProvider: "recaptcha" | "turnstile" | "none";
  recaptchaSiteKey?: string;
  turnstileSiteKey?: string;
  minimumAge: number;
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// GET /api/manifest
// ---------------------------------------------------------------------------

/**
 * Return the public-safe portion of the app manifest.
 *
 * Exposes only the `features` and `payment` sections.
 * The `moderation` section and any internal keys are stripped.
 *
 * @returns JSON PublicManifest
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.apiRead);

    const manifest = await loadManifest();

    // Strip non-public keys
    const publicManifest: PublicManifest = {
      features: manifest.features,
      payment: {
        // Never expose secret keys – only public-facing config
        primaryProvider: manifest.payment.primaryProvider,
        currenciesAccepted: manifest.payment.currenciesAccepted,
        paystackEnabled: manifest.payment.paystackEnabled,
        dodopaymentsEnabled: manifest.payment.dodopaymentsEnabled,
      },
      // CAPTCHA config: expose provider + site key only (never secret keys)
      captchaProvider: manifest.captchaProvider,
      ...(manifest.captchaProvider === "recaptcha" && env.RECAPTCHA_SITE_KEY
        ? { recaptchaSiteKey: env.RECAPTCHA_SITE_KEY }
        : {}),
      ...(manifest.captchaProvider === "turnstile" && env.CLOUDFLARE_TURNSTILE_SITE_KEY
        ? { turnstileSiteKey: env.CLOUDFLARE_TURNSTILE_SITE_KEY }
        : {}),
      minimumAge: manifest.minimumAge,
      updatedAt: manifest.updatedAt ?? Date.now(),
    };

    return NextResponse.json(publicManifest, {
      status: 200,
      headers: {
        // Cache for 60 seconds at the CDN edge – matches Redis TTL
        "Cache-Control": "public, max-age=60, stale-while-revalidate=30",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
