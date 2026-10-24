export const dynamic = 'force-dynamic';

/**
 * app/api/users/[userId]/route.ts
 *
 * Public user profile endpoint.
 *
 * GET /api/users/[userId]
 *   Returns the public profile of any user by their UUID.
 *   Private fields (email, coin_balance, is_admin) are never exposed here.
 *   Requires authentication to prevent unauthenticated scraping.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PublicUserProfile {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  avatar_emoji: string | null;
  city: string | null;
  xp_total: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Route params type
// ---------------------------------------------------------------------------

interface UserParams {
  userId: string;
}

// ---------------------------------------------------------------------------
// GET /api/users/[userId]
// ---------------------------------------------------------------------------

/**
 * Return the public profile of any user by their UUID.
 *
 * Private fields (email, coin_balance, is_admin, etc.) are excluded.
 * Only users who have completed onboarding are returned – incomplete profiles
 * are treated as not found to prevent data leakage.
 *
 * @returns JSON { user: PublicUserProfile }
 */
export const GET = withAuth<UserParams>(async (req, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { userId } = params;

    // Basic UUID format validation
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(userId)) {
      throw badRequest("userId must be a valid UUID");
    }

    const db = await getDb();
    const [row] = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        bio: schema.users.bio,
        avatarUrl: schema.users.avatarUrl,
        avatarEmoji: schema.users.avatarEmoji,
        city: schema.users.city,
        xpTotal: schema.users.xpTotal,
        createdAt: schema.users.createdAt,
        hiddenSections:schema.users.profileHiddenSections,
      })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, userId),
          isNull(schema.users.deletedAt),
          eq(schema.users.onboardingCompleted, true),
          eq(schema.users.isBanned,false),
          sql`NOT(COALESCE(${schema.users.isSuspended},false) AND (${schema.users.suspendedUntil} IS NULL OR ${schema.users.suspendedUntil}>NOW()))`,
          sql`(${schema.users.id}=${auth.user.sub}::uuid OR NOT COALESCE(${schema.users.profilePrivate},false) OR EXISTS(SELECT 1 FROM friendships f WHERE f.status='accepted' AND ((f.requester_id=${auth.user.sub}::uuid AND f.addressee_id=${schema.users.id}) OR (f.addressee_id=${auth.user.sub}::uuid AND f.requester_id=${schema.users.id}))))`,
          sql`NOT EXISTS(SELECT 1 FROM user_blocks b WHERE (b.blocker_id=${auth.user.sub}::uuid AND b.blocked_id=${schema.users.id}) OR (b.blocked_id=${auth.user.sub}::uuid AND b.blocker_id=${schema.users.id}))`
        )
      )
      .limit(1);

    if (!row) throw notFound("User not found");

    const hidden=auth.user.sub===userId?[]:Array.isArray(row.hiddenSections)?row.hiddenSections as string[]:[];
    const user: PublicUserProfile = {
      id: row.id,
      username: row.username,
      display_name: row.displayName,
      bio:hidden.includes("bio")?null:row.bio,
      avatar_url:hidden.includes("avatar")?null:row.avatarUrl,
      avatar_emoji:hidden.includes("avatar")?null:row.avatarEmoji,
      city: row.city,
      xp_total:hidden.includes("xp")?0:Number(row.xpTotal),
      created_at: row.createdAt ? row.createdAt.toISOString() : "",
    };

    return NextResponse.json({ user }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
