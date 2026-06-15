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
  plan: string | null;
  trust_score: number | null;
  is_admin: boolean;
  is_suspended: boolean;
  is_banned: boolean;
  onboarding_completed: boolean;
  report_count: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const searchSchema = z.object({
  q: z.string().max(200).optional(),
  page: z
    .string()
    .optional()
    .transform((v) => (v ? Math.max(1, parseInt(v, 10)) : 1)),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(100, Math.max(1, v ? parseInt(v, 10) : 20))),
});

// ---------------------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------------------

/**
 * Search and list users for admin review.
 *
 * Supports search by username prefix, email, or exact UUID.
 * Returns paginated results with moderation-relevant fields.
 *
 * @returns JSON { users: AdminUserRow[], total: number, page: number, limit: number }
 */
export const GET = withAdminAuth(async (req, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { searchParams } = new URL(req.url);
    const { q, page, limit } = validateSearchParams(searchParams, searchSchema);

    const offset = (page - 1) * limit;

    // Build dynamic WHERE clause
    const conditions: string[] = ["u.deleted_at IS NULL"];
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (q) {
      const UUID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (UUID_RE.test(q)) {
        // Exact UUID lookup
        conditions.push(`u.id = $${paramIdx++}`);
        params.push(q);
      } else if (q.includes("@")) {
        // Email search (case-insensitive)
        conditions.push(`LOWER(u.email) LIKE $${paramIdx++}`);
        params.push(`%${q.toLowerCase()}%`);
      } else {
        // Username prefix search
        conditions.push(`LOWER(u.username) LIKE $${paramIdx++}`);
        params.push(`${q.toLowerCase()}%`);
      }
    }

    const where = conditions.join(" AND ");

    // Count total matching rows
    const { rows: countRows } = await db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM users u WHERE ${where}`,
      params
    );
    const total = parseInt(countRows[0]?.total ?? "0", 10);

    // Fetch paginated users with report count
    const { rows: users } = await db.query<AdminUserRow>(
      `SELECT
         u.id, u.email, u.username, u.display_name, u.avatar_url,
         u.plan, u.trust_score, u.is_admin, u.is_suspended, u.is_banned,
         u.onboarding_completed, u.created_at, u.updated_at,
         COALESCE(r.report_count, 0)::int AS report_count
       FROM users u
       LEFT JOIN (
         SELECT reported_user_id, COUNT(*) AS report_count
         FROM reports
         WHERE status = 'pending'
         GROUP BY reported_user_id
       ) r ON r.reported_user_id = u.id
       WHERE ${where}
       ORDER BY u.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    // BUG-45: audit read-path admin access to user profiles
    writeAuditLog({
      actorId: auth.user.sub,
      action: "user_profile_read",
      metadata: { query: q ?? null, page, limit, total },
    });

    return NextResponse.json(
      { users, total, page, limit, pages: Math.ceil(total / limit) },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
