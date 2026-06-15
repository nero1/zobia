export const dynamic = 'force-dynamic';

/**
 * app/api/admin/actions-log/route.ts
 *
 * GET /api/admin/actions-log
 *   Returns paginated log of automated moderation and system actions.
 *   Requires admin auth.
 *
 *   Query params:
 *     type       - Filter by action_type (string)
 *     userId     - Filter by target user UUID
 *     startDate  - ISO-8601 start date (inclusive)
 *     endDate    - ISO-8601 end date (inclusive)
 *     cursor     - Pagination cursor (created_at of last item)
 *     limit      - Page size (default 50, max 200)
 *
 * POST /api/admin/actions-log
 *   Reverse an automated action (admin only).
 *
 *   Body: { actionId: string, note: string }
 *   Marks the action as reversed in moderation_actions.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, SqlParam } from "@/lib/db";
import { withAdminAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  type: z.string().optional(),
  userId: z.string().uuid().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 200) : 50)),
});

const reverseActionSchema = z.object({
  actionId: z.string().uuid("actionId must be a valid UUID"),
  note: z.string().min(1, "Reversal note is required").max(1000),
});

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface ActionLogRow {
  id: string;
  action_type: string;
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  description: string | null;
  metadata: string | null;
  source_table: string;
  created_at: string;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_note: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a parameterized WHERE fragment for common date/user/cursor filters,
 * using the given column prefix.
 */
function buildFilters(
  prefix: string,
  opts: {
    actionType?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
    cursor?: string;
  }
): { clauses: string[]; params: SqlParam[] } {
  const clauses: string[] = [];
  const params: SqlParam[] = [];
  let idx = 1;

  if (opts.actionType) {
    clauses.push(`${prefix}.action_type = $${idx++}`);
    params.push(opts.actionType);
  }
  if (opts.userId) {
    clauses.push(`${prefix}.user_id = $${idx++}`);
    params.push(opts.userId);
  }
  if (opts.startDate) {
    clauses.push(`${prefix}.created_at >= $${idx++}`);
    params.push(opts.startDate);
  }
  if (opts.endDate) {
    clauses.push(`${prefix}.created_at <= $${idx++}`);
    params.push(opts.endDate);
  }
  if (opts.cursor) {
    clauses.push(`${prefix}.created_at < $${idx++}`);
    params.push(opts.cursor);
  }

  return { clauses, params };
}

// ---------------------------------------------------------------------------
// GET /api/admin/actions-log
// ---------------------------------------------------------------------------

/**
 * Return a paginated list of automated system and moderation actions.
 *
 * Reads from:
 *  - moderation_actions (actor_type='automated')
 *  - notifications (type in ['mystery_xp_drop', 'rank_change', 'guild_war_resolved'])
 *  - automated_actions_log (if the table exists)
 *
 * Results are merged in application memory and sorted by created_at DESC.
 */
export const GET = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const query = validateSearchParams(req.nextUrl.searchParams, listQuerySchema);
    const fetchLimit = query.limit + 1; // over-fetch by 1 to detect hasMore

    const filterOpts = {
      actionType: query.type,
      userId: query.userId,
      startDate: query.startDate,
      endDate: query.endDate,
      cursor: query.cursor,
    };

    // ------------------------------------------------------------------
    // Query 1: moderation_actions (actor_type = 'automated')
    // ------------------------------------------------------------------
    const { clauses: modClauses, params: modParams } = buildFilters("ma", {
      userId: filterOpts.userId,
      startDate: filterOpts.startDate,
      endDate: filterOpts.endDate,
      cursor: filterOpts.cursor,
      // actionType maps to action_type on this table — include if set
      actionType: filterOpts.actionType,
    });
    const modWhere = modClauses.length > 0 ? `AND ${modClauses.join(" AND ")}` : "";
    modParams.push(fetchLimit);

    const { rows: modRows } = await db.query<ActionLogRow>(
      `SELECT
         ma.id,
         ma.action_type,
         ma.target_user_id AS user_id,
         u.username,
         u.display_name,
         ma.reason AS description,
         ma.metadata::text AS metadata,
         'moderation_actions' AS source_table,
         ma.created_at,
         ma.reversed_at,
         ma.reversed_by,
         ma.reversal_note
       FROM moderation_actions ma
       LEFT JOIN users u ON u.id = ma.target_user_id
       WHERE ma.actor_type = 'automated'
         ${modWhere}
       ORDER BY ma.created_at DESC
       LIMIT $${modParams.length}`,
      modParams
    ).catch(() => ({ rows: [] as ActionLogRow[] }));

    // ------------------------------------------------------------------
    // Query 2: automated_actions_log (may not exist — graceful fallback)
    // ------------------------------------------------------------------
    const { clauses: autoClauses, params: autoParams } = buildFilters("aal", filterOpts);
    const autoWhere = autoClauses.length > 0 ? `WHERE ${autoClauses.join(" AND ")}` : "";
    autoParams.push(fetchLimit);

    const { rows: autoRows } = await db.query<ActionLogRow>(
      `SELECT
         aal.id,
         aal.action_type,
         aal.user_id,
         u.username,
         u.display_name,
         aal.description,
         aal.metadata::text AS metadata,
         'automated_actions_log' AS source_table,
         aal.created_at,
         aal.reversed_at,
         aal.reversed_by,
         aal.reverse_note AS reversal_note
       FROM automated_actions_log aal
       LEFT JOIN users u ON u.id = aal.user_id
       ${autoWhere}
       ORDER BY aal.created_at DESC
       LIMIT $${autoParams.length}`,
      autoParams
    ).catch(() => ({ rows: [] as ActionLogRow[] }));

    // ------------------------------------------------------------------
    // Query 3: notifications (relevant automated-action types)
    // ------------------------------------------------------------------
    const NOTIF_TYPES = ["mystery_xp_drop", "rank_change", "guild_war_resolved"];
    const notifClauses: string[] = [`n.type = ANY($1::text[])`];
    const notifParams: SqlParam[] = [NOTIF_TYPES];
    let notifIdx = 2;

    // If a specific type filter was requested, only include if it's in our list
    if (filterOpts.actionType) {
      if (!NOTIF_TYPES.includes(filterOpts.actionType)) {
        // The requested type is not a notification type — skip this query
        notifClauses.push("false");
      } else {
        notifClauses.push(`n.type = $${notifIdx++}`);
        notifParams.push(filterOpts.actionType);
      }
    }
    if (filterOpts.userId) {
      notifClauses.push(`n.user_id = $${notifIdx++}`);
      notifParams.push(filterOpts.userId);
    }
    if (filterOpts.startDate) {
      notifClauses.push(`n.created_at >= $${notifIdx++}`);
      notifParams.push(filterOpts.startDate);
    }
    if (filterOpts.endDate) {
      notifClauses.push(`n.created_at <= $${notifIdx++}`);
      notifParams.push(filterOpts.endDate);
    }
    if (filterOpts.cursor) {
      notifClauses.push(`n.created_at < $${notifIdx++}`);
      notifParams.push(filterOpts.cursor);
    }
    notifParams.push(fetchLimit);

    const { rows: notifRows } = await db.query<ActionLogRow>(
      `SELECT
         n.id,
         n.type AS action_type,
         n.user_id,
         u.username,
         u.display_name,
         (n.payload->>'message') AS description,
         n.payload::text AS metadata,
         'notifications' AS source_table,
         n.created_at,
         NULL::timestamptz AS reversed_at,
         NULL::uuid AS reversed_by,
         NULL::text AS reversal_note
       FROM notifications n
       LEFT JOIN users u ON u.id = n.user_id
       WHERE ${notifClauses.join(" AND ")}
       ORDER BY n.created_at DESC
       LIMIT $${notifIdx}`,
      notifParams
    ).catch(() => ({ rows: [] as ActionLogRow[] }));

    // ------------------------------------------------------------------
    // Merge, sort, and paginate
    // ------------------------------------------------------------------
    const allRows: ActionLogRow[] = [...modRows, ...autoRows, ...notifRows];
    allRows.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const hasMore = allRows.length > query.limit;
    const items = hasMore ? allRows.slice(0, query.limit) : allRows;
    const nextCursor = hasMore ? items[items.length - 1]?.created_at ?? null : null;

    return NextResponse.json({
      success: true,
      data: {
        items: items.map((row) => ({
          id: row.id,
          action_type: row.action_type,
          user_id: row.user_id,
          username: row.username,
          display_name: row.display_name,
          description: row.description,
          source_table: row.source_table,
          created_at: row.created_at,
          reversed_at: row.reversed_at,
          reversed_by: row.reversed_by,
          reversal_note: row.reversal_note,
        })),
        nextCursor,
        hasMore,
        total: items.length,
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/actions-log
// ---------------------------------------------------------------------------

/**
 * Reverse an automated action.
 *
 * Accepts { actionId, note } and marks the action as reversed in
 * moderation_actions (or automated_actions_log if present).
 */
export const POST = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const body = await validateBody(req, reverseActionSchema);
    const adminId = auth.user.sub;

    // Try to reverse in moderation_actions first
    const { rows: modRows } = await db.query<{ id: string }>(
      `UPDATE moderation_actions
       SET reversed_at = NOW(),
           reversed_by = $1,
           reversal_note = $2,
           updated_at = NOW()
       WHERE id = $3
         AND reversed_at IS NULL
       RETURNING id`,
      [adminId, body.note, body.actionId]
    ).catch(() => ({ rows: [] as { id: string }[] }));

    if (modRows.length > 0) {
      return NextResponse.json({
        success: true,
        data: {
          actionId: body.actionId,
          reversedAt: new Date().toISOString(),
          reversedBy: adminId,
          note: body.note,
          sourceTable: "moderation_actions",
        },
        error: null,
      });
    }

    // Try automated_actions_log as fallback
    const { rows: autoRows } = await db.query<{ id: string }>(
      `UPDATE automated_actions_log
       SET reversed_at = NOW(),
           reversed_by = $1,
           reverse_note = $2,
           updated_at = NOW()
       WHERE id = $3
         AND reversed_at IS NULL
       RETURNING id`,
      [adminId, body.note, body.actionId]
    ).catch(() => ({ rows: [] as { id: string }[] }));

    if (autoRows.length > 0) {
      return NextResponse.json({
        success: true,
        data: {
          actionId: body.actionId,
          reversedAt: new Date().toISOString(),
          reversedBy: adminId,
          note: body.note,
          sourceTable: "automated_actions_log",
        },
        error: null,
      });
    }

    // Not found in either table
    throw notFound("Action not found or has already been reversed");
  } catch (err) {
    return handleApiError(err);
  }
});
