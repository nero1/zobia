/**
 * app/api/rooms/[roomId]/gifts/route.ts
 *
 * Room gifting endpoints.
 *
 * GET /api/rooms/:roomId/gifts
 *   Returns the top-gifters leaderboard for the last 24 hours.
 *   Real-time ranking: sorted by total coin value given in the window.
 *   Cached in Redis for 30 seconds to reduce DB load.
 *
 * POST /api/rooms/:roomId/gifts
 *   Gift sending is handled by /api/economy/gifts/send.
 *   This endpoint exists only to document the room-wide spectacle trigger.
 *   Redirects callers to the correct endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { redis } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Leaderboard cache TTL in seconds. */
const LEADERBOARD_CACHE_TTL = 30;

/** Number of top gifters to return (PRD §11 — top 5). */
const TOP_N = 5;

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface TopGifterRow {
  rank: number;
  user_id: string;
  username: string;
  display_name: string;
  avatar_emoji: string;
  total_coins: number;
  gift_count: number;
}

// ---------------------------------------------------------------------------
// GET /api/rooms/[roomId]/gifts
// ---------------------------------------------------------------------------

/**
 * Return the top-gifters leaderboard for the past 24 hours.
 *
 * Results are cached in Redis for 30 seconds per room to reduce database load
 * during high-traffic live events (Drop rooms, etc.).
 *
 * @param req    - Incoming request
 * @param params - Route params containing roomId
 * @returns Array of top gifters with rank, username, and coin totals
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { roomId } = await params as { roomId: string };

    // Verify room exists
    const { rows: roomRows } = await db.query<{ is_active: boolean }>(
      `SELECT is_active FROM rooms WHERE id = $1`,
      [roomId]
    );
    if (!roomRows[0]?.is_active) throw notFound("Room not found");

    // Check Redis cache
    const cacheKey = `room:gifts:top:${roomId}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return NextResponse.json(
          { topGifters: JSON.parse(cached) },
          { status: 200 }
        );
      }
    } catch {
      // Redis miss or error — fall through to DB query
    }

    // Query DB
    const { rows: topGifters } = await db.query<TopGifterRow>(
      `SELECT
         ROW_NUMBER() OVER (ORDER BY SUM(g.coin_value) DESC)::int AS rank,
         g.sender_id     AS user_id,
         u.username,
         u.display_name,
         u.avatar_emoji,
         SUM(g.coin_value)::int   AS total_coins,
         COUNT(g.id)::int         AS gift_count
       FROM gifts g
       JOIN users u ON u.id = g.sender_id
       WHERE g.room_id = $1
         AND g.created_at > NOW() - INTERVAL '24 hours'
       GROUP BY g.sender_id, u.username, u.display_name, u.avatar_emoji
       ORDER BY total_coins DESC
       LIMIT $2`,
      [roomId, TOP_N]
    );

    // Cache result
    try {
      await redis.setex(cacheKey, LEADERBOARD_CACHE_TTL, JSON.stringify(topGifters));
    } catch {
      // Ignore cache write failure
    }

    return NextResponse.json({ topGifters }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/rooms/[roomId]/gifts
// ---------------------------------------------------------------------------

/**
 * Gift sending is handled by POST /api/economy/gifts/send.
 *
 * This endpoint redirects callers to the canonical gift endpoint to avoid
 * duplicate logic. The room-wide spectacle animation is triggered by the
 * economy endpoint via a Supabase Realtime broadcast on channel `room:{roomId}`.
 *
 * @param req    - Incoming request
 * @param params - Route params containing roomId
 * @returns 307 Temporary Redirect to /api/economy/gifts/send
 */
export const POST = withAuth(async (req: NextRequest, { params }) => {
  const { roomId } = await params as { roomId: string };

  return NextResponse.redirect(
    new URL(
      `/api/economy/gifts/send?roomId=${roomId}`,
      req.url
    ),
    307
  );
});
