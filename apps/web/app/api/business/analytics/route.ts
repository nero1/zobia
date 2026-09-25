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
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// GET /api/business/analytics
// ---------------------------------------------------------------------------

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const orm = await getDb();

    // Verify account exists
    const [bizRow] = await orm
      .select({ id: schema.businessAccounts.id })
      .from(schema.businessAccounts)
      .where(eq(schema.businessAccounts.userId, userId))
      .limit(1);
    if (!bizRow) throw notFound("Business account not found");

    // Run all analytic queries in parallel
    const [
      followerResult,
      roomsResult,
      earningsResult,
      broadcastResult,
      vipSubResult,
    ] = await Promise.all([
      // Followers (users who follow this user)
      orm
        .select({ count: sql<string>`COUNT(*)` })
        .from(schema.follows)
        .where(eq(schema.follows.followingId, userId)),
      // Rooms summary
      orm
        .execute<{ total_rooms: string; total_members: string }>(
          sql`SELECT
                COUNT(DISTINCT r.id)::TEXT AS total_rooms,
                COALESCE(SUM(rm.member_count), 0)::TEXT AS total_members
              FROM ${schema.rooms} r
              LEFT JOIN (
                SELECT room_id, COUNT(*) AS member_count
                FROM ${schema.roomMembers}
                GROUP BY room_id
              ) rm ON rm.room_id = r.id
              WHERE r.creator_id = ${userId} AND r.deleted_at IS NULL`
        )
        .then((r) => r.rows),
      // Lifetime creator earnings
      orm
        .select({ total_kobo: sql<string>`COALESCE(SUM(${schema.creatorEarnings.netAmountKobo}), 0)::TEXT` })
        .from(schema.creatorEarnings)
        .where(eq(schema.creatorEarnings.creatorId, userId)),
      // Broadcasts sent
      orm
        .select({ count: sql<string>`COUNT(*)::TEXT` })
        .from(schema.creatorBroadcasts)
        .where(eq(schema.creatorBroadcasts.creatorId, userId)),
      // Active VIP room subscribers
      orm
        .select({ count: sql<string>`COUNT(DISTINCT ${schema.roomSubscriptions.userId})::TEXT` })
        .from(schema.roomSubscriptions)
        .innerJoin(schema.rooms, eq(schema.rooms.id, schema.roomSubscriptions.roomId))
        .where(
          and(
            eq(schema.rooms.creatorId, userId),
            eq(schema.roomSubscriptions.status, "active"),
            gt(schema.roomSubscriptions.expiresAt, sql`NOW()`)
          )
        ),
    ]);

    const analytics = {
      follower_count: parseInt(followerResult[0]?.count ?? "0", 10),
      total_rooms: parseInt(roomsResult[0]?.total_rooms ?? "0", 10),
      total_room_members: parseInt(roomsResult[0]?.total_members ?? "0", 10),
      total_earnings_kobo: parseInt(earningsResult[0]?.total_kobo ?? "0", 10),
      broadcasts_sent: parseInt(broadcastResult[0]?.count ?? "0", 10),
      active_subscribers: parseInt(vipSubResult[0]?.count ?? "0", 10),
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
