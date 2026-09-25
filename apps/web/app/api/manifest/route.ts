/**
 * REDIS-COST-01: this route is deliberately NOT `force-dynamic`.
 *
 * The public manifest is identical for every caller — it carries no
 * per-user state — so it belongs in the CDN, not in a lambda. With
 * `force-dynamic` every client fetch woke a serverless function, which then
 * spent a rate-limit check plus a manifest read in Redis. Served from the edge
 * cache instead, the overwhelming majority of these requests never reach our
 * infrastructure at all.
 *
 * `revalidate` is set rather than omitted so Next.js keeps the route in the
 * dynamic-with-revalidation mode the handler needs (it reads request headers
 * for the rate-limit IP) while still emitting a cacheable response.
 */
export const revalidate = 0;

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
  featureModVisibility: string[];
  auth: { telegramEnabled: boolean };
  phoneVerificationRequired: boolean;
  captchaProvider: "recaptcha" | "turnstile" | "none";
  captchaEnabledSurfaces: string[];
  recaptchaSiteKey?: string;
  turnstileSiteKey?: string;
  minimumAge: number;
  updatedAt: number;
  currency: {
    softNameSingular: string;
    softNamePlural: string;
    premiumNameSingular: string;
    premiumNamePlural: string;
  };
  moments: {
    costCredits: number;
    costStars: number;
    minLevel: number;
  };
  tweets: {
    minLevel: number;
    imageCostCredits: number;
    defaultMaxLength: number;
    longMaxLengthWords: number;
    longTweetCostCredits: number;
  };
  forum: {
    minLevelToPost: number;
    minLevelToComment: number;
    commentBypassCostCredits: number;
  };
  bbforum: {
    minLevelToPost: number;
    imageCostCredits: number;
    imageCostStars: number;
  };
  ads: {
    roomInstreamInterval: number;
    planAdsLevel: Awaited<ReturnType<typeof loadManifest>>["ads"]["planAdsLevel"];
    admob: Awaited<ReturnType<typeof loadManifest>>["ads"]["admob"];
  };
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
      // Safe to expose publicly: only lists which already-public feature
      // keys moderators may access while disabled — no secrets involved.
      featureModVisibility: manifest.featureModVisibility,
      auth: {
        telegramEnabled: manifest.auth.telegramEnabled,
      },
      phoneVerificationRequired: manifest.phoneVerificationRequired,
      payment: {
        // Never expose secret keys – only public-facing config
        primaryProvider: manifest.payment.primaryProvider,
        currenciesAccepted: manifest.payment.currenciesAccepted,
        paystackEnabled: manifest.payment.paystackEnabled,
        cryptoEnabled: manifest.payment.cryptoEnabled,
      },
      // CAPTCHA config: expose provider + site key only (never secret keys)
      captchaProvider: manifest.captchaProvider,
      captchaEnabledSurfaces: manifest.captchaEnabledSurfaces,
      ...(manifest.captchaProvider === "recaptcha" && env.RECAPTCHA_SITE_KEY
        ? { recaptchaSiteKey: env.RECAPTCHA_SITE_KEY }
        : {}),
      ...(manifest.captchaProvider === "turnstile" && env.CLOUDFLARE_TURNSTILE_SITE_KEY
        ? { turnstileSiteKey: env.CLOUDFLARE_TURNSTILE_SITE_KEY }
        : {}),
      minimumAge: manifest.minimumAge,
      updatedAt: manifest.updatedAt ?? Date.now(),
      currency: {
        softNameSingular: manifest.currency.softNameSingular,
        softNamePlural: manifest.currency.softNamePlural,
        premiumNameSingular: manifest.currency.premiumNameSingular,
        premiumNamePlural: manifest.currency.premiumNamePlural,
      },
      moments: {
        costCredits: manifest.moments.costCredits,
        costStars: manifest.moments.costStars,
        minLevel: manifest.moments.minLevel,
      },
      tweets: {
        minLevel: manifest.tweets.minLevel,
        imageCostCredits: manifest.tweets.imageCostCredits,
        defaultMaxLength: manifest.tweets.defaultMaxLength,
        longMaxLengthWords: manifest.tweets.longMaxLengthWords,
        longTweetCostCredits: manifest.tweets.longTweetCostCredits,
      },
      forum: {
        minLevelToPost: manifest.forum.minLevelToPost,
        minLevelToComment: manifest.forum.minLevelToComment,
        commentBypassCostCredits: manifest.forum.commentBypassCostCredits,
      },
      bbforum: {
        minLevelToPost: manifest.bbforum.minLevelToPost,
        imageCostCredits: manifest.bbforum.imageCostCredits,
        imageCostStars: manifest.bbforum.imageCostStars,
      },
      ads: {
        roomInstreamInterval: manifest.ads.roomInstreamInterval,
        planAdsLevel: manifest.ads.planAdsLevel,
        admob: manifest.ads.admob,
      },
    };

    return NextResponse.json(publicManifest, {
      status: 200,
      headers: {
        // REDIS-COST-01: `s-maxage` is what actually makes the CDN hold this —
        // the previous header only had `max-age`, which is a *browser* cache
        // directive, so every cold browser and every native (Capacitor) client
        // still hit the origin. Five minutes at the edge with a long
        // stale-while-revalidate means a manifest change is visible within
        // minutes while near-zero requests reach a lambda or Redis.
        // Admin saves call invalidateManifestCache(), so origin data is never
        // more than one edge TTL behind.
        "Cache-Control": "public, s-maxage=300, max-age=60, stale-while-revalidate=3600",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
