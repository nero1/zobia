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
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, conflict } from "@/lib/api/errors";

interface ChallengeRow {
  id: string;
  challenger_id: string;
  challenged_id: string;
  status: string;
}

export const POST = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: Promise<{ challengeId: string }>; auth: { user: { sub: string } } }
  ) => {
    try {
      const { challengeId } = await params;
      const userId = auth.user.sub;

      const { rows } = await db.query<ChallengeRow>(
        `SELECT id, challenger_id, challenged_id, status FROM nemesis_challenges WHERE id = $1`,
        [challengeId]
      );
      const challenge = rows[0];
      if (!challenge) throw notFound("Challenge not found");
      if (challenge.challenged_id !== userId) {
        throw forbidden("Only the challenged user can accept this challenge");
      }
      if (challenge.status !== "pending") {
        throw conflict(`Challenge is already ${challenge.status}`, "CHALLENGE_NOT_PENDING");
      }

      await db.query(
        `UPDATE nemesis_challenges SET status = 'accepted' WHERE id = $1`,
        [challengeId]
      );

      // Notify the challenger (fire-and-forget)
      db.query(
        `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
         VALUES ($1, 'nemesis_challenge_accepted', $2, false, NOW())`,
        [challenge.challenger_id, JSON.stringify({ accepted_by: userId })]
      ).catch(() => {});

      return NextResponse.json({ success: true, data: { accepted: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
