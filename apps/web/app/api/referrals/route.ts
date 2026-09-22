export const dynamic = 'force-dynamic';

/**
 * app/api/referrals/route.ts
 *
 * GET /api/referrals
 *
 * Returns referral stats for the currently authenticated user.
 *
 * Response:
 * {
 *   referralCode: string,
 *   referralUrl: string,        // https://domain/?r=<numericUserId>
 *   statsTier: "basic" | "full", // plan-gated detail level, see x_manifest `referral_stats_full_plans`
 *   tier1Count: number,         // direct referrals
 *   tier2Count: number,         // second-degree referrals
 *   coinsEarned: number,        // total coins earned via referrals
 *   xpEarned: number,           // total XP earned via referrals
 *   referrals: ReferralRecord[], // [] for statsTier "basic"
 *   visits: {
 *     totalVisits: number,       // all plans
 *     last30Days: { date, visits }[], // [] for statsTier "basic"
 *     topPaths: { path, visits }[],   // [] for statsTier "basic"
 *     conversionRate: number | null,  // null for statsTier "basic"
 *   },
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getCommissionStats } from "@/lib/referrals/commissions";
import { getBasicVisitCount, getFullVisitStats } from "@/lib/referrals/visits";
import { getAllowedPlans, isPlanEligible, allEligibilityOptionsExcept } from "@/lib/plans/eligibility";
import { buildProfileReferralUrl } from "@zobia/shared/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReferralRecord {
  id: string;
  tier: 1 | 2;
  qualified: boolean;
  coinReward: number | null;
  xpReward: number | null;
  referredUsername: string | null;
  referredDisplayName: string | null;
  referredAvatarEmoji: string | null;
  createdAt: string;
  rewardedAt: string | null;
}

interface ReferralRow {
  id: string;
  tier: number;
  qualified: boolean;
  coin_reward: number | null;
  xp_reward: number | null;
  referred_username: string | null;
  referred_display_name: string | null;
  referred_avatar_emoji: string | null;
  created_at: string;
  rewarded_at: string | null;
}

interface UserRow {
  referral_code: string | null;
  plan: string;
  prestige_count: number;
  is_admin: boolean;
  is_moderator: boolean;
  business_tier: string | null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Referral stats for the authenticated user.
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;

    // Fetch user's referral code, plan and eligibility context (used both for
    // the referral URL and the stats-detail plan gate below).
    const userResult = await db.query<UserRow>(
      `SELECT u.referral_code,
              COALESCE(u.plan, 'free') AS plan,
              COALESCE(u.prestige_count, 0) AS prestige_count,
              COALESCE(u.is_admin, false) AS is_admin,
              COALESCE(u.is_moderator, false) AS is_moderator,
              ba.tier AS business_tier
       FROM users u
       LEFT JOIN business_accounts ba ON ba.user_id = u.id AND ba.status = 'active'
       WHERE u.id = $1 AND u.deleted_at IS NULL
       LIMIT 1`,
      [userId]
    );
    const userRow = userResult.rows[0];
    const referralCode = userRow?.referral_code ?? null;

    // Stats-detail tier: admin-configurable via x_manifest key
    // `referral_stats_full_plans` (gate44/settings/referrals), same pattern
    // as the Profile Stats page's `profile_stats_full_plans`. Free users get
    // totals only; everyone else (by default) gets the full breakdown.
    const fullPlans = await getAllowedPlans(
      "referral_stats_full_plans",
      allEligibilityOptionsExcept(["free"])
    );
    const statsTier: "basic" | "full" = userRow
      ? isPlanEligible(userRow.plan, userRow.prestige_count, fullPlans, {
          businessTier: userRow.business_tier,
          isAdmin: userRow.is_admin,
          isModerator: userRow.is_moderator,
        })
        ? "full"
        : "basic"
      : "basic";

    // Build referral URL using ?r=<referralCode> format (PRD §15).
    // Referral codes are numeric strings (e.g. ?r=471370973). The `?r=` param
    // can be attached to ANY public page (profile, room, course, game); this
    // returns the canonical "share my profile" landing link. The client may
    // build per-page links with appendReferralCode(path, referralCode).
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";
    const referralUrl = referralCode
      ? buildProfileReferralUrl(appUrl, referralCode)
      : null;

    // Fetch all referrals where this user is the referrer
    const referralsResult = await db.query<ReferralRow>(
      `SELECT r.id,
              r.tier,
              r.qualified,
              r.coin_reward,
              r.xp_reward,
              r.created_at,
              r.rewarded_at,
              u.username   AS referred_username,
              u.display_name AS referred_display_name,
              u.avatar_emoji AS referred_avatar_emoji
       FROM referrals r
       LEFT JOIN users u ON u.id = r.referred_id AND u.deleted_at IS NULL
       WHERE r.referrer_id = $1
       ORDER BY r.created_at DESC`,
      [userId]
    );

    const referrals: ReferralRecord[] = referralsResult.rows.map((row) => ({
      id: row.id,
      tier: row.tier as 1 | 2,
      qualified: row.qualified,
      coinReward: row.coin_reward,
      xpReward: row.xp_reward,
      referredUsername: row.referred_username,
      referredDisplayName: row.referred_display_name,
      referredAvatarEmoji: row.referred_avatar_emoji,
      createdAt: row.created_at,
      rewardedAt: row.rewarded_at,
    }));

    // Aggregate stats
    const tier1Count = referrals.filter((r) => r.tier === 1).length;
    const tier2Count = referrals.filter((r) => r.tier === 2).length;
    const coinsEarned = referrals.reduce(
      (sum, r) => sum + (r.coinReward ?? 0),
      0
    );
    const xpEarned = referrals.reduce(
      (sum, r) => sum + (r.xpReward ?? 0),
      0
    );

    // Fetch commission stats from purchase-based commission tracking
    const commissionStats = await getCommissionStats(db, userId).catch(() => ({
      totalTier1Coins: 0,
      totalTier2Coins: 0,
      tier1Count: 0,
      tier2Count: 0,
    }));

    // Visit/click stats — basic plans only get the all-time total; the full
    // daily breakdown, top pages and conversion rate are gated by
    // `referral_stats_full_plans` above (default: everyone except free).
    const visits =
      statsTier === "full"
        ? await getFullVisitStats(userId, tier1Count)
        : { totalVisits: await getBasicVisitCount(userId), last30Days: [], topPaths: [], conversionRate: null };

    return NextResponse.json({
      success: true,
      data: {
        referralCode,
        referralUrl,
        statsTier,
        tier1Count,
        tier2Count,
        coinsEarned,
        xpEarned,
        // Free/basic-tier accounts see totals only, not the per-referral list —
        // the "most basic data" plan gate the referrals feature is meant to enforce.
        referrals: statsTier === "full" ? referrals : [],
        visits,
        commissions: {
          tier1CoinsEarned: commissionStats.totalTier1Coins,
          tier2CoinsEarned: commissionStats.totalTier2Coins,
          totalCoinsEarned: commissionStats.totalTier1Coins + commissionStats.totalTier2Coins,
        },
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
