export const dynamic = 'force-dynamic';

/**
 * app/api/rooms/recent/route.ts
 *
 * GET /api/rooms/recent
 *   "Recently Visited" discovery tab. Backed by `room_visits`, upserted on
 *   every GET /api/rooms/[roomId] (see that route). Cursor-paginated on
 *   last_visited_at, same pattern as GET /api/rooms and /api/rooms/pinned,
 *   so it stays cheap regardless of how many rooms a user has ever opened.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { withAuth, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { toRoomCardPayload, type RoomCardSourceRow } from "@/lib/rooms/serialize";

const listRecentQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 50) : 20)),
});

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const query = validateSearchParams(req.nextUrl.searchParams, listRecentQuerySchema);

    const cursorClause = query.cursor
      ? sql`AND rv.last_visited_at < ${query.cursor}`
      : sql``;

    const orm = await getDb();
    const result = await orm.execute<
      RoomCardSourceRow & { last_visited_at: string; is_joined: boolean; is_favorited: boolean } & Record<string, unknown>
    >(sql`
      SELECT
         r.id, r.name, r.description, r.type, r.category, r.city,
         r.cover_emoji, r.cover_image_url, r.slug,
         r.creator_id, u.username AS creator_username, u.display_name AS creator_display_name,
         u.avatar_emoji AS creator_avatar_emoji, u.creator_tier,
         r.member_count, r.max_members, r.is_active, r.is_featured, r.is_sponsored,
         r.subscription_price_ngn, r.entry_fee_ngn, r.drop_starts_at, r.drop_ends_at,
         r.enrolment_fee_ngn, r.total_messages, COALESCE(r.health_score, 100) AS health_score,
         r.created_at, r.updated_at,
         rv.last_visited_at,
         (rm.user_id IS NOT NULL) AS is_joined,
         (rp.id IS NOT NULL)      AS is_favorited
       FROM room_visits rv
       JOIN rooms r ON r.id = rv.room_id AND r.is_active = TRUE
       JOIN users u ON u.id = r.creator_id
       LEFT JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = ${auth.user.sub}
       LEFT JOIN room_pins rp ON rp.room_id = r.id AND rp.user_id = ${auth.user.sub}
       WHERE rv.user_id = ${auth.user.sub} ${cursorClause}
       ORDER BY rv.last_visited_at DESC
       LIMIT ${query.limit}
    `);
    const rows = result.rows;

    const nextCursor =
      rows.length === query.limit ? rows[rows.length - 1]?.last_visited_at ?? null : null;

    const rooms = rows.map((row) =>
      toRoomCardPayload(row, {
        isJoined: row.is_joined,
        isFavorited: row.is_favorited,
        lastVisitedAt: row.last_visited_at,
      })
    );

    return NextResponse.json({
      success: true,
      rooms,
      data: { rooms, nextCursor, hasMore: nextCursor !== null },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
