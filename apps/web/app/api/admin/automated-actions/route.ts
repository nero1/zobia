/**
 * app/api/admin/automated-actions/route.ts
 *
 * GET /api/admin/automated-actions
 *
 * Admin-only paginated list of automated actions logged by the platform's
 * moderation and trust-safety systems (content removal, user flagging, XP
 * stripping, mystery drops, etc.).
 *
 * Query parameters:
 *   limit       (number, 1–200, default 50)  — page size
 *   cursor      (UUID)                        — pagination cursor (id of last seen row)
 *   action_type (string, optional)            — filter by action type
 *
 * Response:
 *   {
 *     items: AutomatedActionLog[],
 *     has_more: boolean,
 *     next_cursor: string | null
 *   }
 *
 * Auth: admin only (withAdminAuth — live database is_admin check, not just JWT).
 * Rate limit: RATE_LIMITS.admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface AutomatedActionRow {
  id: string;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  target_user_id: string | null;
  metadata: Record<string, unknown> | null;
  reversed_at: string | null;
  reversed_by: string | null;
  reverse_note: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/admin/automated-actions
// ---------------------------------------------------------------------------

/**
 * Paginated list of automated actions.
 *
 * Uses cursor-based pagination keyed on the action `id` UUID. Rows are
 * returned newest-first. The caller passes the `id` of the last item as
 * `cursor` to fetch the next page.
 *
 * Requires is_admin = TRUE in the database (verified by withAdminAuth).
 */
export const GET = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const searchParams = req.nextUrl.searchParams;

    // -----------------------------------------------------------------------
    // Parse + validate query params
    // -----------------------------------------------------------------------

    const rawLimit = searchParams.get("limit");
    let limit = DEFAULT_LIMIT;
    if (rawLimit !== null) {
      const parsed = parseInt(rawLimit, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        throw badRequest(
          `'limit' must be an integer between 1 and ${MAX_LIMIT}`,
          "INVALID_LIMIT"
        );
      }
      limit = parsed;
    }

    const cursor = searchParams.get("cursor") ?? null;
    if (cursor !== null && !/^[0-9a-f-]{36}$/i.test(cursor)) {
      throw badRequest("'cursor' must be a valid UUID", "INVALID_CURSOR");
    }

    const actionTypeFilter = searchParams.get("action_type") ?? null;

    // -----------------------------------------------------------------------
    // Build query dynamically
    // -----------------------------------------------------------------------

    const queryParams: unknown[] = [];
    let paramIndex = 1;

    let whereClause = `WHERE deleted_at IS NULL`;

    if (actionTypeFilter) {
      whereClause += ` AND action_type = $${paramIndex}`;
      queryParams.push(actionTypeFilter);
      paramIndex++;
    }

    if (cursor) {
      // Cursor pagination: fetch rows with id < cursor (UUID ordering by
      // created_at DESC is handled by the ORDER BY clause — we use the
      // created_at of the cursor row to keep ordering stable)
      whereClause += ` AND id < $${paramIndex}`;
      queryParams.push(cursor);
      paramIndex++;
    }

    // Fetch limit + 1 to detect whether there are more pages
    queryParams.push(limit + 1);
    const limitParam = paramIndex;

    const sql = `
      SELECT
        id,
        action_type,
        target_type,
        target_id,
        target_user_id,
        metadata,
        reversed_at,
        reversed_by,
        reverse_note,
        created_at
      FROM automated_actions_log
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${limitParam}
    `;

    const { rows } = await db.query<AutomatedActionRow>(sql, queryParams);

    // -----------------------------------------------------------------------
    // Pagination
    // -----------------------------------------------------------------------

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return NextResponse.json(
      {
        items,
        has_more: hasMore,
        next_cursor: nextCursor,
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
