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
import { and, eq, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

    const db = await getDb();

    // Verify target user exists
    const [targetRow] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.id, targetId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!targetRow) throw notFound("User not found");

    await db.transaction(async (tx) => {
      // Upsert the block record
      await tx
        .insert(schema.userBlocks)
        .values({ blockerId, blockedId: targetId })
        .onConflictDoNothing();

      // Cancel any pending friendship between the two
      await tx
        .update(schema.friendships)
        .set({ status: "blocked", updatedAt: new Date() })
        .where(
          and(
            or(
              and(
                eq(schema.friendships.requesterId, blockerId),
                eq(schema.friendships.addresseeId, targetId)
              ),
              and(
                eq(schema.friendships.requesterId, targetId),
                eq(schema.friendships.addresseeId, blockerId)
              )
            ),
            or(
              eq(schema.friendships.status, "pending"),
              eq(schema.friendships.status, "accepted")
            )
          )
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

    const db = await getDb();
    await db
      .delete(schema.userBlocks)
      .where(
        and(
          eq(schema.userBlocks.blockerId, blockerId),
          eq(schema.userBlocks.blockedId, targetId)
        )
      );

    return NextResponse.json({ blocked: false }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
