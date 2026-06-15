export const dynamic = 'force-dynamic';

/**
 * app/api/business/analytics/route.ts
 *
 * GET /api/business/analytics
 *
 * Returns real aggregated analytics for the caller's business account:
 *   - follower_count     : users who follow the business owner
 *   - total_room_members : combined active members across all owned rooms
 *   - total_rooms        : number of rooms owned
 *   - total_earnings_kobo: lifetime creator earnings
 *   - broadcasts_sent    : number of paid broadcasts sent (lifetime)
 *   - subscribers_count  : active VIP room subscribers across all rooms
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// GET /api/business/analytics
// ---------------------------------------------------------------------------

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    // Verify account exists
    const { rows: bizRows } = await db.query<{ id: string }>(
      `SELECT id FROM business_accounts WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (!bizRows[0]) throw notFound("Business account not found");

    // Run all analytic queries in parallel
    const [
      followerResult,
      roomsResult,
      earningsResult,
      broadcastResult,
      vipSubResult,
    ] = await Promise.all([
      // Followers (users who follow this user)
      db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM follows WHERE following_id = $1`,
        [userId]
      ),
      // Rooms summary
      db.query<{ total_rooms: string; total_members: string }>(
        `SELECT
           COUNT(DISTINCT r.id)::TEXT AS total_rooms,
           COALESCE(SUM(rm.member_count), 0)::TEXT AS total_members
         FROM rooms r
         LEFT JOIN (
           SELECT room_id, COUNT(*) AS member_count
           FROM room_members
           GROUP BY room_id
         ) rm ON rm.room_id = r.id
         WHERE r.creator_id = $1 AND r.deleted_at IS NULL`,
        [userId]
      ),
      // Lifetime creator earnings
      db.query<{ total_kobo: string }>(
        `SELECT COALESCE(SUM(net_amount_kobo), 0)::TEXT AS total_kobo
         FROM creator_earnings WHERE creator_id = $1`,
        [userId]
      ),
      // Broadcasts sent
      db.query<{ count: string }>(
        `SELECT COUNT(*)::TEXT AS count FROM creator_broadcasts WHERE creator_id = $1`,
        [userId]
      ),
      // Active VIP room subscribers
      db.query<{ count: string }>(
        `SELECT COUNT(DISTINCT rs.user_id)::TEXT AS count
         FROM room_subscriptions rs
         JOIN rooms r ON r.id = rs.room_id
         WHERE r.creator_id = $1 AND rs.status = 'active' AND rs.expires_at > NOW()`,
        [userId]
      ),
    ]);

    const analytics = {
      follower_count: parseInt(followerResult.rows[0]?.count ?? "0", 10),
      total_rooms: parseInt(roomsResult.rows[0]?.total_rooms ?? "0", 10),
      total_room_members: parseInt(roomsResult.rows[0]?.total_members ?? "0", 10),
      total_earnings_kobo: parseInt(earningsResult.rows[0]?.total_kobo ?? "0", 10),
      broadcasts_sent: parseInt(broadcastResult.rows[0]?.count ?? "0", 10),
      active_subscribers: parseInt(vipSubResult.rows[0]?.count ?? "0", 10),
    };

    return NextResponse.json({
      success: true,
      data: { analytics },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
