export const dynamic = "force-dynamic";

/**
 * app/api/games/challenges/<id>
 *
 * GET    — challenge detail (participants only), including round breakdown.
 * DELETE — delete a pending challenge the opponent hasn't responded to yet
 *          (challenger only; once accepted, use POST .../cancel instead).
 * PATCH  — archive a completed challenge { action: "archive" } (hides it
 *          from the default inbox view without touching the ledger).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { getChallengeDetail, deletePendingChallenge, archiveChallenge } from "@/lib/games/challenges";

export const GET = withAuth(
  async (_req: NextRequest, { params, auth }: { params: { id: string }; auth: any }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
      await assertGamesEnabled();
      const challenge = await getChallengeDetail(params.id, auth.user.sub);
      return NextResponse.json({ success: true, data: { challenge }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

export const DELETE = withAuth(
  async (_req: NextRequest, { params, auth }: { params: { id: string }; auth: any }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
      await assertGamesEnabled();
      await deletePendingChallenge(params.id, auth.user.sub);
      return NextResponse.json({ success: true, data: null, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

const patchSchema = z.object({ action: z.literal("archive") });

export const PATCH = withAuth(
  async (req: NextRequest, { params, auth }: { params: { id: string }; auth: any }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
      await assertGamesEnabled();
      await validateBody(req, patchSchema);
      await archiveChallenge(params.id, auth.user.sub);
      return NextResponse.json({ success: true, data: null, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
