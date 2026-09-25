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
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { ONLINE_WINDOW_MS } from "@/lib/presence/keys";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PresenceStatus = "online" | "recently_active" | "offline";

/** Threshold (ms) for "recently active" when Redis key is absent. */
const RECENTLY_ACTIVE_MS = 60 * 60 * 1000; // 1 hour

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

      // REDIS-COST-01: one indexed read answers all three states. This used to
      // be a Redis GET for "online" plus a DB read for "recently active" —
      // two round-trips and a Redis command for information `last_active_at`
      // already held on its own. See lib/presence/keys.ts.
      const db = await getDb();
      const [row] = await db
        .select({ lastActiveAt: schema.users.lastActiveAt })
        .from(schema.users)
        .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
        .limit(1);

      const lastActiveAtDate = row?.lastActiveAt ?? null;

      let status: PresenceStatus = "offline";
      if (lastActiveAtDate) {
        const sinceLastActive = Date.now() - lastActiveAtDate.getTime();
        if (sinceLastActive <= ONLINE_WINDOW_MS) {
          status = "online";
        } else if (sinceLastActive <= RECENTLY_ACTIVE_MS) {
          status = "recently_active";
        }
      }

      return NextResponse.json({
        success: true,
        data: { status, lastActiveAt: lastActiveAtDate ? lastActiveAtDate.toISOString() : null },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
