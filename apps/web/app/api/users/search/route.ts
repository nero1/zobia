export const dynamic = 'force-dynamic';

/**
 * app/api/users/search/route.ts
 *
 * GET /api/users/search?q=<term>
 *
 * Searches users by username prefix.
 * Used by gifting UIs, DM targeting, and user-to-user features.
 *
 * Returns up to 10 users matching the query (min 2 chars).
 * Excludes the requesting user from results.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, ilike, isNull, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() ?? "";

    if (q.length < 2) {
      throw badRequest("Search query must be at least 2 characters");
    }

    const userId = auth.user.sub;

    const db = await getDb();
    const prefixPattern = `${q}%`;
    const containsPattern = `%${q}%`;

    const rows = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        avatarEmoji: schema.users.avatarEmoji,
        isFriend: sql<boolean>`EXISTS (
           SELECT 1 FROM ${schema.friendships} f
           WHERE f.status = 'accepted'
             AND ((f.requester_id = ${userId} AND f.addressee_id = ${schema.users.id})
               OR (f.addressee_id = ${userId} AND f.requester_id = ${schema.users.id}))
         )`,
      })
      .from(schema.users)
      .where(
        and(
          or(ilike(schema.users.username, prefixPattern), ilike(schema.users.displayName, containsPattern)),
          isNull(schema.users.deletedAt),
          ne(schema.users.id, userId)
        )
      )
      .orderBy(sql`CASE WHEN ${schema.users.username} ILIKE ${prefixPattern} THEN 0 ELSE 1 END`, schema.users.username)
      .limit(20);

    return NextResponse.json({
      success: true,
      data: {
        users: rows.map((r) => ({
          id: r.id,
          username: r.username,
          displayName: r.displayName ?? r.username,
          avatarEmoji: r.avatarEmoji,
          isFriend: r.isFriend,
        })),
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
