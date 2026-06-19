export const dynamic = 'force-dynamic';

/**
 * app/api/users/[userId]/unfollow/route.ts
 *
 * Convenience alias: POST /api/users/:userId/unfollow
 * Equivalent to DELETE /api/follows with { userId } in the body.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthContext } from "@/lib/api/middleware";
import { badRequest, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface UnfollowCtx {
  params: Promise<{ userId: string }>;
  auth: AuthContext;
}

export const POST = withAuth(async (req: NextRequest, { params, auth }: UnfollowCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { userId: targetId } = await params;
    const callerId = auth.user.sub;

    if (!targetId) throw badRequest("userId is required");

    await db.query(
      "DELETE FROM follows WHERE follower_id = $1 AND following_id = $2",
      [callerId, targetId]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
});
