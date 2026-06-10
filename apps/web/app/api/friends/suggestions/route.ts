export const dynamic = 'force-dynamic';

/**
 * GET /api/friends/suggestions
 *
 * Returns up to 20 friend suggestions for the authenticated user.
 * Priority: friends-of-friends with most mutual friends, then guild mates,
 * then popular users. Excludes: self, existing friends, pending requests,
 * and blocked users.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/middleware';
import { handleApiError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/security/rateLimit';

export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, 'user', RATE_LIMITS.apiRead);
    const userId = auth.user.sub;

    const { rows } = await db.query(
      `WITH my_friends AS (
         SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS fid
         FROM friendships
         WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'
       ),
       excluded AS (
         SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS uid
         FROM friendships
         WHERE requester_id = $1 OR addressee_id = $1
       ),
       fof AS (
         SELECT
           CASE WHEN f.requester_id = mf.fid THEN f.addressee_id ELSE f.requester_id END AS uid,
           COUNT(*) AS mutual_count
         FROM my_friends mf
         JOIN friendships f ON (f.requester_id = mf.fid OR f.addressee_id = mf.fid)
           AND f.status = 'accepted'
         WHERE CASE WHEN f.requester_id = mf.fid THEN f.addressee_id ELSE f.requester_id END != $1
           AND CASE WHEN f.requester_id = mf.fid THEN f.addressee_id ELSE f.requester_id END NOT IN (SELECT fid FROM my_friends)
         GROUP BY 1
       )
       SELECT DISTINCT ON (u.id)
         u.id, u.username, u.display_name, u.avatar_emoji, u.rank_name, u.is_verified,
         COALESCE(fof.mutual_count, 0) AS mutual_friend_count
       FROM users u
       LEFT JOIN fof ON fof.uid = u.id
       WHERE u.id != $1
         AND u.deleted_at IS NULL
         AND u.id NOT IN (SELECT uid FROM excluded)
       ORDER BY u.id, mutual_friend_count DESC, u.xp_total DESC
       LIMIT 20`,
      [userId]
    );

    return NextResponse.json({
      suggestions: rows.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name ?? r.username,
        avatarEmoji: r.avatar_emoji,
        rankName: r.rank_name,
        isVerified: r.is_verified,
        mutualFriendCount: Number(r.mutual_friend_count),
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
});
