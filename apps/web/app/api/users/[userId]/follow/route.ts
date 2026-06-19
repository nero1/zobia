export const dynamic = 'force-dynamic';

/**
 * app/api/users/[userId]/follow/route.ts
 *
 * Convenience alias: POST /api/users/:userId/follow
 * Equivalent to POST /api/follows with { userId } in the body.
 *
 * This route exists so that profile pages can call a RESTful URL pattern
 * (/api/users/:id/follow) rather than the collection endpoint (/api/follows).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthContext } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface FollowCtx {
  params: Promise<{ userId: string }>;
  auth: AuthContext;
}

export const POST = withAuth(async (req: NextRequest, { params, auth }: FollowCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { userId: targetId } = await params;
    const callerId = auth.user.sub;

    if (!targetId) throw badRequest("userId is required");
    if (targetId === callerId) throw badRequest("Cannot follow yourself");

    const { rows: targetRows } = await db.query(
      "SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1",
      [targetId]
    );
    if (!targetRows[0]) throw notFound("User not found");

    await db.query(
      `INSERT INTO follows (follower_id, following_id)
       VALUES ($1, $2)
       ON CONFLICT (follower_id, following_id) DO NOTHING`,
      [callerId, targetId]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
});
