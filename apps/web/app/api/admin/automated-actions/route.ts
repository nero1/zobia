export const dynamic = 'force-dynamic';

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
import { and, desc, eq, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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
export const GET = withAdminAuth(async (req: NextRequest, { params, auth }) => {
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
    // Build query
    // -----------------------------------------------------------------------

    const orm = await getDb();
    const aal = schema.automatedActionsLog;
    const conditions = [];
    if (actionTypeFilter) conditions.push(eq(aal.actionType, actionTypeFilter));
    if (cursor) conditions.push(lt(aal.id, cursor));

    const rows = await orm
      .select({
        id: aal.id,
        action_type: aal.actionType,
        target_type: aal.targetType,
        target_id: aal.targetId,
        target_user_id: aal.targetUserId,
        metadata: aal.metadata,
        reversed_at: aal.reversedAt,
        reversed_by: aal.reversedBy,
        reverse_note: aal.reverseNote,
        created_at: aal.createdAt,
      })
      .from(aal)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(aal.createdAt))
      .limit(limit + 1);

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
