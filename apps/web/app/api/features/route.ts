export const dynamic = 'force-dynamic';

/**
 * GET /api/features
 *
 * Returns feature flags relevant to authenticated users.
 * Reads from x_manifest via the cached manifest loader.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { loadManifest, getManifestValue } from "@/lib/manifest";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb, schema } from "@/lib/db/drizzle";
import { getAllowedPlans as getJsonManifestList, isPlanEligible as userEligibleForFeature, allEligibilityOptionsExcept } from "@/lib/plans/eligibility";

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const manifest = await loadManifest();
    const orm = await getDb();

    const [twoFaRaw, twoFaModsRaw, userRows] = await Promise.all([
      getManifestValue("auth_2fa_enabled"),
      getManifestValue("auth_2fa_required_for_mods"),
      orm
        .select({
          plan: schema.users.plan,
          prestige_count: schema.users.prestigeCount,
          is_admin: schema.users.isAdmin,
          is_moderator: schema.users.isModerator,
          business_tier: schema.businessAccounts.tier,
        })
        .from(schema.users)
        .leftJoin(
          schema.businessAccounts,
          and(eq(schema.businessAccounts.userId, schema.users.id), eq(schema.businessAccounts.status, "active"))
        )
        .where(eq(schema.users.id, auth.user.sub))
        .limit(1)
        .catch(() => [] as Array<{ plan: string; prestige_count: number; is_admin: boolean; is_moderator: boolean; business_tier: string | null }>),
    ]);

    const user = userRows[0] ?? { plan: "free", prestige_count: 0, is_admin: false, is_moderator: false, business_tier: null };
    const eligibilityContext = { businessTier: user.business_tier, isAdmin: user.is_admin, isModerator: user.is_moderator };

    const [lockAllowed, hideAllowed, noFrAllowed, hideableSections, onlineStatusAllowed] = await Promise.all([
      getJsonManifestList('privacy_can_lock_profile', allEligibilityOptionsExcept(['free', 'plus'])),
      getJsonManifestList('privacy_can_hide_sections', allEligibilityOptionsExcept(['free'])),
      getJsonManifestList('privacy_can_disable_friend_requests', allEligibilityOptionsExcept(['free'])),
      getJsonManifestList('privacy_hideable_sections', ['avatar', 'bio', 'rank', 'xp', 'guild', 'seasons', 'badges']),
      getJsonManifestList('privacy_can_show_online_status', ['pro', 'max', 'prestige_1']),
    ]);

    return NextResponse.json(
      {
        twoFaEnabled: twoFaRaw !== "false",
        pinEnabled: manifest.features.pinAuth,
        twoFaRequiredForMods: twoFaModsRaw === "true",
        privacy: {
          canLockProfile: userEligibleForFeature(user.plan, user.prestige_count, lockAllowed, eligibilityContext),
          canHideSections: userEligibleForFeature(user.plan, user.prestige_count, hideAllowed, eligibilityContext),
          canDisableFriendRequests: userEligibleForFeature(user.plan, user.prestige_count, noFrAllowed, eligibilityContext),
          canShowOnlineStatus: userEligibleForFeature(user.plan, user.prestige_count, onlineStatusAllowed, eligibilityContext),
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
