export const dynamic = "force-dynamic";

/**
 * app/api/games/saves/[saveId]/route.ts
 *
 * GET    /api/games/saves/:saveId  – load a save's full state (to resume)
 * DELETE /api/games/saves/:saveId  – delete a save
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { assertGamesEnabled } from "@/lib/games/config";
import { getSaveForUser, deleteSaveForUser } from "@/lib/games/saves";

export const GET = withAuth(
  async (_req: NextRequest, { params, auth }: { params: { saveId: string }; auth: { user: { sub: string } } }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
      await assertGamesEnabled();
      const save = await getSaveForUser(auth.user.sub, params.saveId);
      if (!save) throw notFound("Save not found.");
      return NextResponse.json({ success: true, data: { save }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

export const DELETE = withAuth(
  async (_req: NextRequest, { params, auth }: { params: { saveId: string }; auth: { user: { sub: string } } }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
      await assertGamesEnabled();
      await deleteSaveForUser(auth.user.sub, params.saveId);
      return NextResponse.json({ success: true, data: { deleted: true }, error: null });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
