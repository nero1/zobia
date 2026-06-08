export const dynamic = 'force-dynamic';

/**
 * app/api/nemesis/challenge/[challengeId]/standings/route.ts
 *
 * GET /api/nemesis/challenge/[challengeId]/standings
 *
 * Returns live standings for a 7-day nemesis XP sprint challenge.
 *
 * Flow:
 *   1. Fetch the challenge by ID
 *   2. Verify caller is the challenger or the target
 *   3. Calculate XP earned since challenge start for both users
 *   4. Calculate days remaining
 *   5. Fetch usernames for both parties
 *   6. Return full standings
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChallengeRow {
  id: string;
  challenger_id: string;
  challenged_id: string;
  status: string;
  created_at: string;
  expires_at: string;
}

interface UserProfileRow {
  id: string;
  username: string;
  avatar_emoji: string;
}

interface XPEarnedRow {
  xp_earned: number;
}

// ---------------------------------------------------------------------------
// GET /api/nemesis/challenge/[challengeId]/standings
// ---------------------------------------------------------------------------

/**
 * Return standings for a 7-day nemesis XP sprint.
 * Only accessible to the challenger or the target.
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: { params: Promise<{ challengeId: string }>; auth: { user: { sub: string } } }
  ) => {
    try {
      const { challengeId } = await params;
      const userId = auth.user.sub;

      await enforceRateLimit(userId, "user", RATE_LIMITS.apiRead);

      // 1. Fetch the challenge
      const challengeResult = await db.query<ChallengeRow>(
        `SELECT id, challenger_id, challenged_id, status, created_at, expires_at
         FROM nemesis_challenges
         WHERE id = $1`,
        [challengeId]
      );
      const challenge = challengeResult.rows[0];
      if (!challenge) throw notFound("Challenge not found");

      // 2. Verify caller is challenger or target
      const isChallenger = challenge.challenger_id === userId;
      const isChallenged = challenge.challenged_id === userId;
      if (!isChallenger && !isChallenged) {
        throw forbidden("You are not a participant in this challenge");
      }

      const challengerId = challenge.challenger_id;
      const targetId = challenge.challenged_id;
      const challengeStartedAt = challenge.created_at;

      // 3. Calculate XP earned since challenge start for both users
      const [challengerXPResult, targetXPResult] = await Promise.all([
        db.query<XPEarnedRow>(
          `SELECT COALESCE(SUM(amount), 0)::int AS xp_earned
           FROM xp_ledger
           WHERE user_id = $1 AND created_at >= $2`,
          [challengerId, challengeStartedAt]
        ),
        db.query<XPEarnedRow>(
          `SELECT COALESCE(SUM(amount), 0)::int AS xp_earned
           FROM xp_ledger
           WHERE user_id = $1 AND created_at >= $2`,
          [targetId, challengeStartedAt]
        ),
      ]);

      const challengerXP = challengerXPResult.rows[0]?.xp_earned ?? 0;
      const targetXP = targetXPResult.rows[0]?.xp_earned ?? 0;

      // 4. Calculate days remaining
      const endsAt = new Date(challenge.expires_at);
      const now = Date.now();
      const msRemaining = endsAt.getTime() - now;
      const daysRemaining = Math.max(0, Math.ceil(msRemaining / 86400000));

      // 5. Fetch usernames and avatar emojis for both parties
      const profilesResult = await db.query<UserProfileRow>(
        `SELECT id, username, avatar_emoji
         FROM users
         WHERE id = ANY($1) AND deleted_at IS NULL`,
        [[challengerId, targetId]]
      );

      const profileMap = new Map<string, UserProfileRow>();
      for (const profile of profilesResult.rows) {
        profileMap.set(profile.id, profile);
      }

      const challengerProfile = profileMap.get(challengerId);
      const targetProfile = profileMap.get(targetId);

      // 6. Return standings
      return NextResponse.json({
        success: true,
        data: {
          challengeId,
          challenger: {
            userId: challengerId,
            username: challengerProfile?.username ?? null,
            avatarEmoji: challengerProfile?.avatar_emoji ?? null,
            xpEarned: challengerXP,
          },
          target: {
            userId: targetId,
            username: targetProfile?.username ?? null,
            avatarEmoji: targetProfile?.avatar_emoji ?? null,
            xpEarned: targetXP,
          },
          daysRemaining,
          endsAt: challenge.expires_at,
          status: challenge.status,
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
