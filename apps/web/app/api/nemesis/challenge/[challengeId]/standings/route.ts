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
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

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

      const db = await getDb();

      // 1. Fetch the challenge
      const [challenge] = await db
        .select({
          id: schema.nemesisChallenges.id,
          challengerId: schema.nemesisChallenges.challengerId,
          challengedId: schema.nemesisChallenges.challengedId,
          status: schema.nemesisChallenges.status,
          createdAt: schema.nemesisChallenges.createdAt,
          expiresAt: schema.nemesisChallenges.expiresAt,
        })
        .from(schema.nemesisChallenges)
        .where(eq(schema.nemesisChallenges.id, challengeId));
      if (!challenge) throw notFound("Challenge not found");

      // 2. Verify caller is challenger or target
      const isChallenger = challenge.challengerId === userId;
      const isChallenged = challenge.challengedId === userId;
      if (!isChallenger && !isChallenged) {
        throw forbidden("You are not a participant in this challenge");
      }

      const challengerId = challenge.challengerId;
      const targetId = challenge.challengedId;
      const challengeStartedAt = challenge.createdAt as unknown as string;

      // 3. Calculate XP earned since challenge start for both users
      const xpEarnedSelect = (uid: string) =>
        db
          .select({
            xpEarned: sql<number>`COALESCE(SUM(${schema.xpLedger.amount}), 0)::int`,
          })
          .from(schema.xpLedger)
          .where(
            and(
              eq(schema.xpLedger.userId, uid),
              gte(schema.xpLedger.createdAt, challenge.createdAt as any)
            )
          );

      const [challengerXPResult, targetXPResult] = await Promise.all([
        xpEarnedSelect(challengerId),
        xpEarnedSelect(targetId),
      ]);

      const challengerXP = challengerXPResult[0]?.xpEarned ?? 0;
      const targetXP = targetXPResult[0]?.xpEarned ?? 0;

      // 4. Calculate days remaining
      const endsAt = new Date(challenge.expiresAt as unknown as string);
      const now = Date.now();
      const msRemaining = endsAt.getTime() - now;
      const daysRemaining = Math.max(0, Math.ceil(msRemaining / 86400000));

      // 5. Fetch usernames and avatar emojis for both parties
      const profiles = await db
        .select({
          id: schema.users.id,
          username: schema.users.username,
          avatarEmoji: schema.users.avatarEmoji,
        })
        .from(schema.users)
        .where(
          and(
            inArray(schema.users.id, [challengerId, targetId]),
            isNull(schema.users.deletedAt)
          )
        );

      const profileMap = new Map<string, (typeof profiles)[number]>();
      for (const profile of profiles) {
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
            avatarEmoji: challengerProfile?.avatarEmoji ?? null,
            xpEarned: challengerXP,
          },
          target: {
            userId: targetId,
            username: targetProfile?.username ?? null,
            avatarEmoji: targetProfile?.avatarEmoji ?? null,
            xpEarned: targetXP,
          },
          daysRemaining,
          endsAt: challenge.expiresAt,
          status: challenge.status,
        },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
