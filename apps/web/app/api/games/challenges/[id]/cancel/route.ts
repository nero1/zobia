export const dynamic = "force-dynamic";

/** POST /api/games/challenges/<id>/cancel — challenger cancels; escrow refunded. */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { cancelChallenge } from "@/lib/games/challenges";

export const POST = withAuth(
  async (_req: NextRequest, { params, auth }: { params: { id: string }; auth: any }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
      await assertGamesEnabled();
      await cancelChallenge(params.id, auth.user.sub);
      return NextResponse.json({ success: true, data: { cancelled: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
