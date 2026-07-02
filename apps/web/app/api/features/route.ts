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
import { db } from "@/lib/db";

async function getJsonManifestList(key: string, fallback: string[]): Promise<string[]> {
  try {
    const raw = await getManifestValue(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as string[];
  } catch {
    return fallback;
  }
}

function userEligibleForFeature(plan: string, prestigeCount: number, allowed: string[]): boolean {
  const p = plan.toLowerCase();
  if (allowed.includes(p)) return true;
  for (const entry of allowed) {
    const m = /^prestige_(\d+)$/.exec(entry);
    if (m && prestigeCount >= parseInt(m[1], 10)) return true;
  }
  return false;
}

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const manifest = await loadManifest();

    const [twoFaRaw, twoFaModsRaw, userRow] = await Promise.all([
      getManifestValue("auth_2fa_enabled"),
      getManifestValue("auth_2fa_required_for_mods"),
      db.query<{ plan: string; prestige_count: number }>(
        `SELECT COALESCE(plan,'free') AS plan, COALESCE(prestige_count,0) AS prestige_count FROM users WHERE id = $1 LIMIT 1`,
        [auth.user.sub]
      ).catch(() => ({ rows: [] as Array<{ plan: string; prestige_count: number }> })),
    ]);

    const user = userRow.rows[0] ?? { plan: "free", prestige_count: 0 };

    const [lockAllowed, hideAllowed, noFrAllowed, hideableSections, onlineStatusAllowed] = await Promise.all([
      getJsonManifestList('privacy_can_lock_profile', ['pro', 'max', 'prestige_1']),
      getJsonManifestList('privacy_can_hide_sections', ['plus', 'pro', 'max', 'prestige_1']),
      getJsonManifestList('privacy_can_disable_friend_requests', ['plus', 'pro', 'max', 'prestige_1']),
      getJsonManifestList('privacy_hideable_sections', ['avatar', 'bio', 'rank', 'xp', 'guild', 'seasons', 'badges']),
      getJsonManifestList('privacy_can_show_online_status', ['pro', 'max', 'prestige_1']),
    ]);

    return NextResponse.json(
      {
        twoFaEnabled: twoFaRaw !== "false",
        pinEnabled: manifest.features.pinAuth,
        twoFaRequiredForMods: twoFaModsRaw === "true",
        privacy: {
          canLockProfile: userEligibleForFeature(user.plan, user.prestige_count, lockAllowed),
          canHideSections: userEligibleForFeature(user.plan, user.prestige_count, hideAllowed),
          canDisableFriendRequests: userEligibleForFeature(user.plan, user.prestige_count, noFrAllowed),
          canShowOnlineStatus: userEligibleForFeature(user.plan, user.prestige_count, onlineStatusAllowed),
          hideableSections,
        },
      },
      {
        status: 200,
        headers: { "Cache-Control": "private, max-age=60" },
      }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
