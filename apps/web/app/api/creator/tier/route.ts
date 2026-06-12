export const dynamic = 'force-dynamic';

/**
 * app/api/creator/tier/route.ts
 *
 * GET /api/creator/tier
 *   Returns the caller's current creator tier and progress toward the next tier.
 *
 * POST /api/creator/tier/upgrade
 *   Checks eligibility and upgrades creator tier if criteria are met.
 *
 * Creator tier ladder (PRD §14 — corrected thresholds):
 *   Rookie   → Rising   (requires: 100 Room members  OR 30-day login streak)
 *   Rising   → Verified (requires: 500 Room members  OR equivalent earnings ≥ ₦10,000)
 *   Verified → Elite    (requires: 2,000 Room members OR equivalent earnings ≥ ₦50,000)
 *   Elite    → Icon     (invitation-only, admin sets icon_creator_invitation flag)
 *
 * "Room members" = unique followers across all of the creator's public rooms.
 * "Equivalent earnings" = lifetime gross earnings from all creator revenue streams.
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
// Types
// ---------------------------------------------------------------------------

type CreatorTierName = 'rookie' | 'rising' | 'verified' | 'elite' | 'icon';

/** Thresholds for primary path (members) and OR alternative paths. */
interface TierThresholds {
  /** Unique Room members required (primary path). */
  members: number;
  /** Login streak in days (alternative path — only for Rising). */
  streakDays?: number;
  /** Lifetime gross earnings in kobo (alternative path). */
  earningsKobo?: number;
  /** If true, tier is invitation-only (admin sets flag on user record). */
  invitationOnly?: boolean;
}

const TIER_ORDER: CreatorTierName[] = ['rookie', 'rising', 'verified', 'elite', 'icon'];

/** PRD §14 corrected tier thresholds. */
const TIER_THRESHOLDS: Record<CreatorTierName, TierThresholds> = {
  rookie:   { members: 0 },
  rising:   { members: 100,   streakDays: 30 },
  verified: { members: 500,   earningsKobo: 1_000_000 },   // ₦10,000 in kobo
  elite:    { members: 2_000, earningsKobo: 5_000_000 },   // ₦50,000 in kobo
  icon:     { members: 0,     invitationOnly: true },
};

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface CreatorRow {
  is_creator: boolean;
  creator_tier: CreatorTierName | null;
  xp_creator: number;
  login_streak: number;
  icon_creator_invitation: boolean;
}

interface StatsRow {
  room_members: number;
  total_earnings_kobo: number;
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
    `SELECT is_creator, creator_tier, xp_creator, login_streak,
            COALESCE(icon_creator_invitation, FALSE) AS icon_creator_invitation
     FROM users
     WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );

  const creator = creatorRows[0];
  if (!creator) throw new Error("User not found");

  const { rows: statRows } = await db.query<StatsRow>(
    `SELECT
       -- Unique members across all creator rooms (PRD §14 "Room members")
       (SELECT COUNT(DISTINCT rm.user_id)::int
        FROM room_members rm
        JOIN rooms r ON r.id = rm.room_id
        WHERE r.creator_id = $1 AND r.is_active = TRUE AND rm.left_at IS NULL)
       AS room_members,

       -- Lifetime gross earnings from all creator revenue sources
       COALESCE(
         (SELECT SUM(gross_amount_kobo) FROM creator_earnings WHERE creator_id = $1),
         0
       )::bigint AS total_earnings_kobo`,
    [userId]
  );

  return { creator, stats: statRows[0] ?? { room_members: 0, total_earnings_kobo: 0 } };
}

/**
 * Check if creator meets requirements for a given target tier.
 * Supports both primary (members) and OR alternative paths.
 */
function meetsRequirements(
  targetTier: CreatorTierName,
  creator: CreatorRow,
  stats: StatsRow
): boolean {
  const thresholds = TIER_THRESHOLDS[targetTier];

  if (thresholds.invitationOnly) {
    return creator.icon_creator_invitation === true;
  }

  // Primary path: enough Room members
  if (stats.room_members >= thresholds.members) return true;

  // OR: login streak alternative (only for Rising)
  if (thresholds.streakDays !== undefined && creator.login_streak >= thresholds.streakDays) {
    return true;
  }

  // OR: earnings alternative (Verified, Elite)
  if (thresholds.earningsKobo !== undefined && stats.total_earnings_kobo >= thresholds.earningsKobo) {
    return true;
  }

  return false;
}

/**
 * Compute progress toward the next tier for display.
 */
function computeTierProgress(
  currentTier: CreatorTierName,
  creator: CreatorRow,
  stats: StatsRow
): {
  nextTier: CreatorTierName | null;
  isEligible: boolean;
  thresholds: TierThresholds | null;
  progress: {
    roomMembers: { current: number; required: number };
    loginStreak?: { current: number; required: number };
    earningsKobo?: { current: number; required: number };
  } | null;
} {
  const currentIndex = TIER_ORDER.indexOf(currentTier);
  const nextTierName = TIER_ORDER[currentIndex + 1] ?? null;

  if (!nextTierName) {
    return { nextTier: null, isEligible: false, thresholds: null, progress: null };
  }

  const thresholds = TIER_THRESHOLDS[nextTierName];
  const isEligible = meetsRequirements(nextTierName, creator, stats);

  const progress: ReturnType<typeof computeTierProgress>['progress'] = {
    roomMembers: { current: stats.room_members, required: thresholds.members },
  };

  if (thresholds.streakDays !== undefined) {
    progress.loginStreak = { current: creator.login_streak, required: thresholds.streakDays };
  }
  if (thresholds.earningsKobo !== undefined) {
    progress.earningsKobo = {
      current: Number(stats.total_earnings_kobo),
      required: thresholds.earningsKobo,
    };
  }

  return { nextTier: nextTierName, isEligible, thresholds, progress };
}

// ---------------------------------------------------------------------------
// GET /api/creator/tier
// ---------------------------------------------------------------------------

export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const userId = auth.user.sub;
    const { creator, stats } = await fetchCreatorStats(userId);

    if (!creator.is_creator) {
      throw forbidden("Creator account required");
    }

    const currentTier = (creator.creator_tier ?? "rookie") as CreatorTierName;
    const tierProgress = computeTierProgress(currentTier, creator, stats);

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
// POST /api/creator/tier — trigger upgrade check
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const userId = auth.user.sub;
    const { creator, stats } = await fetchCreatorStats(userId);

    if (!creator.is_creator) {
      throw forbidden("Creator account required");
    }

    const currentTier = (creator.creator_tier ?? "rookie") as CreatorTierName;
    const tierProgress = computeTierProgress(currentTier, creator, stats);

    if (!tierProgress.nextTier) {
      throw conflict("You are already at the highest creator tier (Icon)");
    }

    if (!tierProgress.isEligible) {
      return NextResponse.json(
        {
          upgraded: false,
          currentTier,
          nextTier: tierProgress.nextTier,
          thresholds: tierProgress.thresholds,
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

    // Notify user of tier upgrade
    await db.query(
      `INSERT INTO notifications (user_id, type, title, body, metadata, created_at)
       VALUES ($1, 'creator_tier_upgrade', $2, $3, $4, NOW())`,
      [
        userId,
        `You reached ${tierProgress.nextTier.charAt(0).toUpperCase() + tierProgress.nextTier.slice(1)} Creator! 🎉`,
        `Congratulations! You've unlocked new creator features and a higher revenue share.`,
        JSON.stringify({ previousTier: currentTier, newTier: tierProgress.nextTier }),
      ]
    );

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
