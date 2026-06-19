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
 *   tier1Count: number,         // direct referrals
 *   tier2Count: number,         // second-degree referrals
 *   coinsEarned: number,        // total coins earned via referrals
 *   xpEarned: number,           // total XP earned via referrals
 *   referrals: ReferralRecord[]
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getCommissionStats } from "@/lib/referrals/commissions";
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

    // Fetch user's referral code and numeric ID (used in referral URL)
    const userResult = await db.query<UserRow>(
      `SELECT referral_code FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    const referralCode = userResult.rows[0]?.referral_code ?? null;

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

    return NextResponse.json({
      success: true,
      data: {
        referralCode,
        referralUrl,
        tier1Count,
        tier2Count,
        coinsEarned,
        xpEarned,
        referrals,
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
