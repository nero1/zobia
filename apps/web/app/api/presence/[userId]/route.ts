export const dynamic = 'force-dynamic';

/**
 * app/api/presence/[userId]/route.ts
 *
 * GET /api/presence/[userId]
 *
 * Returns the presence status of any user:
 *   - 'online':           Redis TTL key exists (seen within last 5 minutes)
 *   - 'recently_active':  No Redis key but last_active_at within the past hour
 *   - 'offline':          last_active_at older than 1 hour (or null)
 *
 * Response: { status: 'online' | 'recently_active' | 'offline', lastActiveAt: string | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { presenceRedisKey } from "@/lib/presence/keys";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PresenceStatus = "online" | "recently_active" | "offline";

/** Threshold (ms) for "recently active" when Redis key is absent. */
const RECENTLY_ACTIVE_MS = 60 * 60 * 1000; // 1 hour

interface UserPresenceRow {
  last_active_at: string | null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Get the presence status for a specific user.
 * Requires authentication (any logged-in user can check another's presence).
 */
export const GET = withAuth(
  async (
    req: NextRequest,
    { params }: { params: { userId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { userId } = await params as { userId: string };

      if (!userId || userId === "undefined" || userId === "null") {
        throw badRequest("userId is required", "MISSING_USER_ID");
      }

      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!UUID_RE.test(userId)) {
        throw badRequest("userId must be a valid UUID", "INVALID_USER_ID");
      }

      // Check Redis first (cheapest, most accurate for online status)
      const redisKey = presenceRedisKey(userId);
      const onlineFlag = await redis.get(redisKey);

      if (onlineFlag !== null) {
        return NextResponse.json({
          success: true,
          data: { status: "online" as PresenceStatus, lastActiveAt: null },
          error: null,
        });
      }

      // Fall back to database last_active_at
      const result = await db.query<UserPresenceRow>(
        `SELECT last_active_at FROM users
         WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId]
      );

      const lastActiveAt = result.rows[0]?.last_active_at ?? null;

      let status: PresenceStatus = "offline";
      if (lastActiveAt) {
        const lastActive = new Date(lastActiveAt).getTime();
        if (Date.now() - lastActive <= RECENTLY_ACTIVE_MS) {
          status = "recently_active";
        }
      }

      return NextResponse.json({
        success: true,
        data: { status, lastActiveAt },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
