export const dynamic = "force-dynamic";

/**
 * app/api/games/challenges/<id>
 *
 * GET — challenge detail (participants only), including round breakdown.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { getChallengeDetail } from "@/lib/games/challenges";

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
