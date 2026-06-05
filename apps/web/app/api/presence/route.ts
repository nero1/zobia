/**
 * app/api/presence/route.ts
 *
 * POST /api/presence
 *   Update the authenticated user's presence.
 *   - Sets last_active_at in the database.
 *   - Sets a 5-minute Redis TTL key so other users can see "online" status.
 *
 * GET /api/presence/[userId]  →  see /app/api/presence/[userId]/route.ts
 *   Returns presence status: 'online' | 'recently_active' | 'offline'
 *   - online:           Redis key exists (active within 5 min)
 *   - recently_active:  last_active_at within the last hour
 *   - offline:          otherwise
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redis } from "@/lib/redis";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** TTL (seconds) for the Redis presence key. Online = key exists. */
const ONLINE_TTL_SECONDS = 5 * 60; // 5 minutes

/** Threshold (ms) for "recently active" when Redis key is absent. */
const RECENTLY_ACTIVE_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds the Redis key that signals a user is currently online.
 */
export function presenceRedisKey(userId: string): string {
  return `presence:online:${userId}`;
}

// ---------------------------------------------------------------------------
// POST /api/presence — update own presence
// ---------------------------------------------------------------------------

/**
 * Record a presence heartbeat for the authenticated user.
 * Should be called periodically by the client (e.g. every 3–4 minutes).
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    const now = new Date().toISOString();

    // Update last_active_at in the database
    await db.query(
      `UPDATE users SET last_active_at = $1, updated_at = $1 WHERE id = $2`,
      [now, userId]
    );

    // Set Redis presence key with TTL
    await redis.set(presenceRedisKey(userId), "1", "EX", ONLINE_TTL_SECONDS);

    return NextResponse.json({ success: true, data: { status: "online" }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/presence — platform-wide active user count
// ---------------------------------------------------------------------------

/**
 * Returns the number of users active in the last 5 minutes and any ongoing
 * platform event (flash XP, etc.) for display on the home screen activity banner.
 */
export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    // Count distinct users who earned XP in the last hour (PRD §2.2: "X people earned XP in the last hour")
    const { rows } = await db.query<{ count: string }>(
      `SELECT COUNT(DISTINCT user_id) AS count FROM xp_ledger
       WHERE created_at > NOW() - INTERVAL '1 hour'`
    );
    const activeCount = parseInt(rows[0]?.count ?? "0", 10);

    // Optionally return active platform event (flash XP, etc.)
    const { rows: eventRows } = await db.query<{ id: string; name: string; xp_multiplier: number; ends_at: string }>(
      `SELECT id, name, xp_multiplier, ends_at FROM platform_events
       WHERE is_active = true AND starts_at <= NOW() AND ends_at > NOW()
       LIMIT 1`
    );
    const event = eventRows[0] ?? null;

    return NextResponse.json({
      success: true,
      data: { activeCount, event },
      error: null
    });
  } catch (err) {
    return handleApiError(err);
  }
});
