/**
 * app/api/creator/tier/route.ts
 *
 * GET /api/creator/tier
 *   Returns the caller's current creator tier and progress toward the next tier.
 *
 * POST /api/creator/tier/upgrade
 *   Checks eligibility and upgrades creator tier if criteria are met.
 *   (Upgrade is triggered automatically by the system, but this endpoint
 *   allows creators to check and claim eligibility.)
 *
 * Creator tier ladder (from PRD):
 *   Rookie   → Rising   (requires: 10 followers, 1 room created)
 *   Rising   → Verified (requires: 100 followers, 1 paid subscriber, 500 XP creator track)
 *   Verified → Elite    (requires: 1,000 followers, 50 paid subscribers, 2,000 XP creator track)
 *   Elite    → Icon     (requires: 10,000 followers, 500 paid subscribers, 5,000 XP creator track)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import {
  handleApiError,
  forbidden,
  conflict,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type CreatorTierName = 'rookie' | 'rising' | 'verified' | 'elite' | 'icon';

interface TierRequirements {
  followers: number;
  paidSubscribers: number;
  creatorXp: number;
  roomsCreated: number;
}

const TIER_ORDER: CreatorTierName[] = ['rookie', 'rising', 'verified', 'elite', 'icon'];

const TIER_REQUIREMENTS: Record<CreatorTierName, TierRequirements> = {
  rookie: { followers: 0, paidSubscribers: 0, creatorXp: 0, roomsCreated: 0 },
  rising: { followers: 10, paidSubscribers: 0, creatorXp: 0, roomsCreated: 1 },
  verified: { followers: 100, paidSubscribers: 1, creatorXp: 500, roomsCreated: 1 },
  elite: { followers: 1_000, paidSubscribers: 50, creatorXp: 2_000, roomsCreated: 1 },
  icon: { followers: 10_000, paidSubscribers: 500, creatorXp: 5_000, roomsCreated: 1 },
};

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface CreatorRow {
  is_creator: boolean;
  creator_tier: CreatorTierName | null;
  xp_creator: number;
  follower_count: number;
}

interface StatsRow {
  paid_subscribers: number;
  rooms_created: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the caller's current creator stats for tier calculation.
 */
async function fetchCreatorStats(
  userId: string
): Promise<{ creator: CreatorRow; stats: StatsRow }> {
  const { rows: creatorRows } = await db.query<CreatorRow>(
    `SELECT is_creator, creator_tier, xp_creator,
            (SELECT COUNT(*)::int FROM user_follows WHERE following_id = $1) AS follower_count
     FROM users
     WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );

  const creator = creatorRows[0];
  if (!creator) throw new Error("User not found");

  const { rows: statRows } = await db.query<StatsRow>(
    `SELECT
       (SELECT COUNT(DISTINCT rs.user_id)::int
        FROM room_subscriptions rs
        JOIN rooms r ON r.id = rs.room_id
        WHERE r.creator_id = $1 AND rs.status = 'active')
       AS paid_subscribers,
       (SELECT COUNT(*)::int FROM rooms WHERE creator_id = $1 AND is_active = TRUE)
       AS rooms_created`,
    [userId]
  );

  return { creator, stats: statRows[0] ?? { paid_subscribers: 0, rooms_created: 0 } };
}

/**
 * Compute the next tier the creator is progressing toward.
 *
 * @param currentTier - Current creator tier name
 * @param stats       - Current creator stats
 * @returns Progress object toward next tier
 */
function computeTierProgress(
  currentTier: CreatorTierName,
  xpCreator: number,
  followerCount: number,
  stats: StatsRow
): {
  nextTier: CreatorTierName | null;
  isEligible: boolean;
  requirements: TierRequirements | null;
  progress: {
    followers: { current: number; required: number };
    paidSubscribers: { current: number; required: number };
    creatorXp: { current: number; required: number };
    roomsCreated: { current: number; required: number };
  } | null;
} {
  const currentIndex = TIER_ORDER.indexOf(currentTier);
  const nextTierName = TIER_ORDER[currentIndex + 1] ?? null;

  if (!nextTierName) {
    return { nextTier: null, isEligible: false, requirements: null, progress: null };
  }

  const req = TIER_REQUIREMENTS[nextTierName];

  const progress = {
    followers: { current: followerCount, required: req.followers },
    paidSubscribers: { current: stats.paid_subscribers, required: req.paidSubscribers },
    creatorXp: { current: xpCreator, required: req.creatorXp },
    roomsCreated: { current: stats.rooms_created, required: req.roomsCreated },
  };

  const isEligible =
    followerCount >= req.followers &&
    stats.paid_subscribers >= req.paidSubscribers &&
    xpCreator >= req.creatorXp &&
    stats.rooms_created >= req.roomsCreated;

  return { nextTier: nextTierName, isEligible, requirements: req, progress };
}

// ---------------------------------------------------------------------------
// GET /api/creator/tier
// ---------------------------------------------------------------------------

/**
 * Return the caller's current creator tier and progress toward the next tier.
 *
 * @param req - Incoming request
 * @returns Tier, eligibility, and progress object
 */
export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const userId = auth.user.sub;
    const { creator, stats } = await fetchCreatorStats(userId);

    if (!creator.is_creator) {
      throw forbidden("Creator account required");
    }

    const currentTier = (creator.creator_tier ?? "rookie") as CreatorTierName;
    const tierProgress = computeTierProgress(
      currentTier,
      creator.xp_creator,
      creator.follower_count,
      stats
    );

    return NextResponse.json(
      {
        currentTier,
        tierIndex: TIER_ORDER.indexOf(currentTier) + 1,
        totalTiers: TIER_ORDER.length,
        ...tierProgress,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/creator/tier/upgrade (via POST /api/creator/tier with action=upgrade)
// ---------------------------------------------------------------------------

/**
 * Check eligibility and upgrade the creator's tier.
 *
 * Idempotent: if already at the next tier, returns a 409 Conflict.
 *
 * @param req - Incoming request
 * @returns New tier name and updated progress on success
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const userId = auth.user.sub;
    const { creator, stats } = await fetchCreatorStats(userId);

    if (!creator.is_creator) {
      throw forbidden("Creator account required");
    }

    const currentTier = (creator.creator_tier ?? "rookie") as CreatorTierName;
    const tierProgress = computeTierProgress(
      currentTier,
      creator.xp_creator,
      creator.follower_count,
      stats
    );

    if (!tierProgress.nextTier) {
      throw conflict("You are already at the highest creator tier (Icon)");
    }

    if (!tierProgress.isEligible) {
      return NextResponse.json(
        {
          upgraded: false,
          currentTier,
          nextTier: tierProgress.nextTier,
          requirements: tierProgress.requirements,
          progress: tierProgress.progress,
          message: "You do not yet meet the requirements for the next tier",
        },
        { status: 200 }
      );
    }

    // Perform upgrade
    await db.query(
      `UPDATE users
       SET creator_tier = $1, updated_at = NOW()
       WHERE id = $2`,
      [tierProgress.nextTier, userId]
    );

    // Award creator milestone XP
    const milestoneXp = 200;
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE users
         SET xp_total = xp_total + $1, xp_creator = xp_creator + $1, updated_at = NOW()
         WHERE id = $2`,
        [milestoneXp, userId]
      );
      await tx.query(
        `INSERT INTO xp_ledger
           (user_id, amount, track, source, multiplier, base_amount)
         VALUES ($1, $2, 'creator', 'creator_milestone', 100, $2)`,
        [userId, milestoneXp]
      );
    });

    return NextResponse.json(
      {
        upgraded: true,
        previousTier: currentTier,
        newTier: tierProgress.nextTier,
        xpAwarded: milestoneXp,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
