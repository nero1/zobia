export const dynamic = 'force-dynamic';

/**
 * app/api/nemesis/challenge/[challengeId]/accept/route.ts
 *
 * POST /api/nemesis/challenge/[challengeId]/accept
 *
 * The challenged party accepts a pending XP-sprint challenge, clearing it
 * from the "unaccepted after Z days" sweep (see
 * expireUnacceptedNemesisChallenges in lib/nemesis/nemesisEngine.ts) so the
 * challenger keeps their current Nemesis instead of being reassigned.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, conflict } from "@/lib/api/errors";

export const POST = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: Promise<{ challengeId: string }>; auth: { user: { sub: string } } }
  ) => {
    try {
      const { challengeId } = await params;
      const userId = auth.user.sub;

      const orm = await getDb();

      const rows = await orm
        .select({
          id: schema.nemesisChallenges.id,
          challengerId: schema.nemesisChallenges.challengerId,
          challengedId: schema.nemesisChallenges.challengedId,
          status: schema.nemesisChallenges.status,
        })
        .from(schema.nemesisChallenges)
        .where(eq(schema.nemesisChallenges.id, challengeId))
        .limit(1);
      const challenge = rows[0];
      if (!challenge) throw notFound("Challenge not found");
      if (challenge.challengedId !== userId) {
        throw forbidden("Only the challenged user can accept this challenge");
      }
      if (challenge.status !== "pending") {
        throw conflict(`Challenge is already ${challenge.status}`, "CHALLENGE_NOT_PENDING");
      }

      await orm
        .update(schema.nemesisChallenges)
        .set({ status: "accepted" })
        .where(eq(schema.nemesisChallenges.id, challengeId));

      // Notify the challenger (fire-and-forget)
      orm
        .insert(schema.notifications)
        .values({
          userId: challenge.challengerId,
          type: "nemesis_challenge_accepted",
          payload: { accepted_by: userId },
          isRead: false,
        })
        .catch(() => {});

      return NextResponse.json({ success: true, data: { accepted: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
