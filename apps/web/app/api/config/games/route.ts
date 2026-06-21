export const dynamic = "force-dynamic";

/**
 * GET /api/config/games — public, unauthenticated UI config for the games
 * feature: whether it's enabled, the currency display names, the wager rake and
 * whether ads should render. Safe to expose (no secrets).
 */

import { NextResponse } from "next/server";
import { loadManifest } from "@/lib/manifest";

export async function GET() {
  try {
    const m = await loadManifest();
    const CACHE = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" };
    return NextResponse.json({
      success: true,
      data: {
        enabled: m.features.games,
        adsEnabled: m.features.admobAds,
        currency: m.currency,
        wagerRakePct: m.games.wagerRakePct,
        challengeExpiryHours: m.games.challengeExpiryHours,
      },
      error: null,
    }, { headers: CACHE });
  } catch {
    return NextResponse.json({
      success: true,
      data: {
        enabled: true,
        adsEnabled: false,
        currency: { softNameSingular: "Credit", softNamePlural: "Credits", premiumNameSingular: "Star", premiumNamePlural: "Stars" },
        wagerRakePct: 5,
        challengeExpiryHours: 48,
      },
      error: null,
    });
  }
}
