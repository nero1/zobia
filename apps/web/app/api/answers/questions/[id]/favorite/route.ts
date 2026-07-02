export const dynamic = "force-dynamic";

/**
 * app/api/answers/questions/[id]/favorite/route.ts
 *
 * POST   /api/answers/questions/:id/favorite — favorite a question
 * DELETE /api/answers/questions/:id/favorite — unfavorite a question
 *
 * Mirrors /api/rooms/pinned and /api/games/favorites.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toggleFavorite } from "@/lib/forum/service";

export const POST = withAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    const { id } = await params;
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.forumVote);
    const result = await toggleFavorite(auth.user.sub, id, true);
    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    const { id } = await params;
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.forumVote);
    const result = await toggleFavorite(auth.user.sub, id, false);
    return NextResponse.json({ success: true, data: result, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
