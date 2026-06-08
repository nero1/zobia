export const dynamic = 'force-dynamic';

/**
 * app/api/users/[userId]/block/route.ts
 *
 * POST   /api/users/[userId]/block   — Block a user
 * DELETE /api/users/[userId]/block   — Unblock a user
 *
 * When A blocks B:
 *   - B can no longer send DMs to A
 *   - B's messages in A's feed are hidden (client-side filter)
 *   - Any pending friend request between A and B is cancelled
 *
 * The response is identical whether or not the block already exists (idempotent).
 * Blocking is always silent — B receives no notification.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface UserParams {
  userId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// POST /api/users/[userId]/block
// ---------------------------------------------------------------------------

export const POST = withAuth<UserParams>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { userId: targetId } = params;
    if (!UUID_RE.test(targetId)) throw badRequest("userId must be a valid UUID");

    const blockerId = auth.user.sub;

    if (targetId === blockerId) {
      throw badRequest("You cannot block yourself");
    }

    // Verify target user exists
    const { rows: targetRows } = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [targetId]
    );
    if (!targetRows[0]) throw notFound("User not found");

    await db.transaction(async (tx) => {
      // Upsert the block record
      await tx.query(
        `INSERT INTO user_blocks (blocker_id, blocked_id)
         VALUES ($1, $2)
         ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
        [blockerId, targetId]
      );

      // Cancel any pending friendship between the two
      await tx.query(
        `UPDATE friendships
         SET status = 'blocked', updated_at = NOW()
         WHERE ((requester_id = $1 AND addressee_id = $2)
             OR (requester_id = $2 AND addressee_id = $1))
           AND status IN ('pending', 'accepted')`,
        [blockerId, targetId]
      );
    });

    return NextResponse.json({ blocked: true }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/users/[userId]/block
// ---------------------------------------------------------------------------

export const DELETE = withAuth<UserParams>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const { userId: targetId } = params;
    if (!UUID_RE.test(targetId)) throw badRequest("userId must be a valid UUID");

    const blockerId = auth.user.sub;

    await db.query(
      `DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`,
      [blockerId, targetId]
    );

    return NextResponse.json({ blocked: false }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
