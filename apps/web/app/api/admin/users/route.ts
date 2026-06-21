export const dynamic = 'force-dynamic';

/**
 * app/api/admin/users/route.ts
 *
 * Admin user management endpoint.
 *
 * GET /api/admin/users?q=...&page=1&limit=20
 *   - Admin-only (is_admin verified from DATABASE, not just JWT)
 *   - Search users by username, email, or UUID
 *   - Returns paginated list with trust_score, plan, and report history summary
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { writeAuditLog } from "@/lib/audit/auditLog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminUserRow {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  avatar_emoji: string | null;
  plan: string | null;
  trust_score: number | null;
  is_admin: boolean;
  is_moderator: boolean;
  is_suspended: boolean;
  is_banned: boolean;
  onboarding_completed: boolean;
  report_count: number;
  payment_history_count: number;
  message_count: number;
  rooms_created: number;
  created_at: string;
  updated_at: string;
  last_active_at: string | null;
  city: string | null;
}

export interface AdminUser {
  id: string;
  email: string | null;
  username: string | null;
  plan: string | null;
  avatarEmoji: string | null;
  trustScore: number | null;
  joinedAt: string;
  lastActiveAt: string | null;
  status: "active" | "suspended" | "banned";
  isModerator: boolean;
  city: string;
  reportHistoryCount: number;
  paymentHistoryCount: number;
  messageCount: number;
  roomsCreated: number;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const searchSchema = z.object({
  q: z.string().max(200).optional(),
  // ADMIN-01: cursor-based (keyset) pagination — avoids O(N) full-table scans from OFFSET
  cursor: z.string().optional(), // last seen user id (UUID) from previous page
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(100, Math.max(1, v ? parseInt(v, 10) : 20))),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    plan: row.plan,
    avatarEmoji: row.avatar_emoji,
    trustScore: row.trust_score,
    joinedAt: row.created_at,
    lastActiveAt: row.last_active_at ?? null,
    status: row.is_banned ? "banned" : row.is_suspended ? "suspended" : "active",
    isModerator: row.is_moderator,
    city: row.city ?? "",
    reportHistoryCount: row.report_count,
    paymentHistoryCount: row.payment_history_count,
    messageCount: row.message_count,
    roomsCreated: row.rooms_created,
  };
}

// ---------------------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------------------

/**
 * Search and list users for admin review.
 *
 * Supports search by username prefix, email, or exact UUID.
 * Returns paginated results with moderation-relevant fields.
 *
 * @returns JSON { users: AdminUser[], total: number, page: number, limit: number, pages: number }
 */
export const GET = withAdminAuth(async (req, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { searchParams } = new URL(req.url);
    const { q, cursor, limit } = validateSearchParams(searchParams, searchSchema);

    // Build dynamic WHERE clause
    const conditions: string[] = ["u.deleted_at IS NULL"];
    const queryParams: (string | number)[] = [];
    let paramIdx = 1;

    if (q) {
      const UUID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (UUID_RE.test(q)) {
        // Exact UUID lookup
        conditions.push(`u.id = $${paramIdx++}`);
        queryParams.push(q);
      } else if (q.includes("@")) {
        // Email search (case-insensitive)
        conditions.push(`LOWER(u.email) LIKE $${paramIdx++}`);
        queryParams.push(`%${q.toLowerCase()}%`);
      } else {
        // Username prefix search
        conditions.push(`LOWER(u.username) LIKE $${paramIdx++}`);
        queryParams.push(`${q.toLowerCase()}%`);
      }
    }

    // ADMIN-01: keyset pagination — cursor is the created_at+id of the last row on previous page.
    // Format: "<iso-timestamp>|<uuid>". Falls back gracefully if cursor is absent or malformed.
    let cursorCreatedAt: string | null = null;
    let cursorId: string | null = null;
    if (cursor) {
      const sep = cursor.lastIndexOf("|");
      if (sep > 0) {
        cursorCreatedAt = cursor.slice(0, sep);
        cursorId = cursor.slice(sep + 1);
      }
    }

    if (cursorCreatedAt && cursorId) {
      conditions.push(`(u.created_at, u.id) < ($${paramIdx}, $${paramIdx + 1})`);
      queryParams.push(cursorCreatedAt, cursorId);
      paramIdx += 2;
    }

    const where = conditions.join(" AND ");

    // ADMIN-01: no COUNT(*) query needed with keyset pagination (it would scan the full table).
    // The response omits `total` in favour of `hasMore` + `nextCursor`.

    // ADMIN-03: correlated subqueries instead of full-table GROUP BY derived tables.
    // Each subquery scans only the rows for the current page's users (index lookups).
    // ADMIN-02: count ALL-TIME reports, not just pending ones.
    const { rows: rawUsers } = await db.query<AdminUserRow>(
      `SELECT
         u.id, u.email, u.username, u.display_name, u.avatar_url,
         u.avatar_emoji, u.plan, u.trust_score, u.is_admin, u.is_moderator,
         u.is_suspended, u.is_banned, u.onboarding_completed,
         u.created_at, u.updated_at, u.last_active_at, u.city,
         (SELECT COUNT(*)::int FROM reports       WHERE reported_user_id = u.id)  AS report_count,
         (SELECT COUNT(*)::int FROM payments      WHERE user_id = u.id)           AS payment_history_count,
         (SELECT COUNT(*)::int FROM room_messages WHERE sender_id = u.id)         AS message_count,
         (SELECT COUNT(*)::int FROM rooms         WHERE creator_id = u.id)        AS rooms_created
       FROM users u
       WHERE ${where}
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT $${paramIdx}`,
      [...queryParams, limit + 1]
    );

    // Detect if there is a next page by fetching limit+1 rows
    const hasMore = rawUsers.length > limit;
    const pageRows = hasMore ? rawUsers.slice(0, limit) : rawUsers;
    const users: AdminUser[] = pageRows.map(toAdminUser);

    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow
      ? `${lastRow.created_at}|${lastRow.id}`
      : null;

    // BUG-45: audit read-path admin access to user profiles
    writeAuditLog({
      actorId: auth.user.sub,
      action: "user_profile_read",
      metadata: { query: q ?? null, cursor: cursor ?? null, limit },
    });

    return NextResponse.json(
      { users, hasMore, nextCursor, limit },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
