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
import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
  action_type: string | null;
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  description: string | null;
  metadata: string | null;
  source_table: string;
  created_at: Date | string | null;
  reversed_at: Date | string | null;
  reversed_by: string | null;
  reversal_note: string | null;
}

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

interface FilterOpts {
  actionType?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
  cursor?: string;
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
 *  - automated_actions_log
 *
 * Results are merged in application memory and sorted by created_at DESC.
 */
export const GET = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const query = validateSearchParams(req.nextUrl.searchParams, listQuerySchema);
    const fetchLimit = query.limit + 1; // over-fetch by 1 to detect hasMore

    const filterOpts: FilterOpts = {
      actionType: query.type,
      userId: query.userId,
      startDate: query.startDate,
      endDate: query.endDate,
      cursor: query.cursor,
    };

    const orm = await getDb();

    // ------------------------------------------------------------------
    // Query 1: moderation_actions (actor_type = 'automated')
    // ------------------------------------------------------------------
    const ma = schema.moderationActions;
    const modConditions = [eq(ma.actorType, "automated")];
    if (filterOpts.actionType) modConditions.push(eq(ma.actionType, filterOpts.actionType));
    if (filterOpts.userId) modConditions.push(eq(ma.targetUserId, filterOpts.userId));
    if (filterOpts.startDate) modConditions.push(gte(ma.createdAt, new Date(filterOpts.startDate)));
    if (filterOpts.endDate) modConditions.push(lte(ma.createdAt, new Date(filterOpts.endDate)));
    if (filterOpts.cursor) modConditions.push(lt(ma.createdAt, new Date(filterOpts.cursor)));

    const modRows: ActionLogRow[] = await orm
      .select({
        id: ma.id,
        action_type: ma.actionType,
        user_id: ma.targetUserId,
        username: schema.users.username,
        display_name: schema.users.displayName,
        description: ma.reason,
        metadata: sql<string>`${ma.metadata}::text`,
        source_table: sql<string>`'moderation_actions'`,
        created_at: ma.createdAt,
        reversed_at: ma.reversedAt,
        reversed_by: ma.reversedBy,
        reversal_note: ma.reversalNote,
      })
      .from(ma)
      .leftJoin(schema.users, eq(schema.users.id, ma.targetUserId))
      .where(and(...modConditions))
      .orderBy(desc(ma.createdAt))
      .limit(fetchLimit)
      .catch(() => [] as ActionLogRow[]);

    // ------------------------------------------------------------------
    // Query 2: automated_actions_log
    // ------------------------------------------------------------------
    const aal = schema.automatedActionsLog;
    const autoConditions = [];
    if (filterOpts.actionType) autoConditions.push(eq(aal.actionType, filterOpts.actionType));
    if (filterOpts.userId) autoConditions.push(eq(aal.userId, filterOpts.userId));
    if (filterOpts.startDate) autoConditions.push(gte(aal.createdAt, new Date(filterOpts.startDate)));
    if (filterOpts.endDate) autoConditions.push(lte(aal.createdAt, new Date(filterOpts.endDate)));
    if (filterOpts.cursor) autoConditions.push(lt(aal.createdAt, new Date(filterOpts.cursor)));

    const autoRows: ActionLogRow[] = await orm
      .select({
        id: aal.id,
        action_type: aal.actionType,
        user_id: aal.userId,
        username: schema.users.username,
        display_name: schema.users.displayName,
        description: aal.description,
        metadata: sql<string>`${aal.metadata}::text`,
        source_table: sql<string>`'automated_actions_log'`,
        created_at: aal.createdAt,
        reversed_at: aal.reversedAt,
        reversed_by: aal.reversedBy,
        reversal_note: aal.reverseNote,
      })
      .from(aal)
      .leftJoin(schema.users, eq(schema.users.id, aal.userId))
      .where(autoConditions.length > 0 ? and(...autoConditions) : undefined)
      .orderBy(desc(aal.createdAt))
      .limit(fetchLimit)
      .catch(() => [] as ActionLogRow[]);

    // ------------------------------------------------------------------
    // Query 3: notifications (relevant automated-action types)
    // ------------------------------------------------------------------
    const NOTIF_TYPES = ["mystery_xp_drop", "rank_change", "guild_war_resolved"];
    const n = schema.notifications;
    let skipNotifQuery = false;
    const notifConditions = [inArray(n.type, NOTIF_TYPES)];

    if (filterOpts.actionType) {
      if (!NOTIF_TYPES.includes(filterOpts.actionType)) {
        skipNotifQuery = true;
      } else {
        notifConditions.push(eq(n.type, filterOpts.actionType));
      }
    }
    if (filterOpts.userId) notifConditions.push(eq(n.userId, filterOpts.userId));
    if (filterOpts.startDate) notifConditions.push(gte(n.createdAt, new Date(filterOpts.startDate)));
    if (filterOpts.endDate) notifConditions.push(lte(n.createdAt, new Date(filterOpts.endDate)));
    if (filterOpts.cursor) notifConditions.push(lt(n.createdAt, new Date(filterOpts.cursor)));

    const notifRows: ActionLogRow[] = skipNotifQuery
      ? []
      : await orm
          .select({
            id: n.id,
            action_type: n.type,
            user_id: n.userId,
            username: schema.users.username,
            display_name: schema.users.displayName,
            description: sql<string | null>`(${n.payload}->>'message')`,
            metadata: sql<string>`${n.payload}::text`,
            source_table: sql<string>`'notifications'`,
            created_at: n.createdAt,
            reversed_at: sql<null>`NULL::timestamptz`,
            reversed_by: sql<null>`NULL::uuid`,
            reversal_note: sql<null>`NULL::text`,
          })
          .from(n)
          .leftJoin(schema.users, eq(schema.users.id, n.userId))
          .where(and(...notifConditions))
          .orderBy(desc(n.createdAt))
          .limit(fetchLimit)
          .catch(() => [] as ActionLogRow[]);

    // ------------------------------------------------------------------
    // Merge, sort, and paginate
    // ------------------------------------------------------------------
    const allRows: ActionLogRow[] = [...modRows, ...autoRows, ...notifRows];
    allRows.sort(
      (a, b) =>
        new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime()
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

    const orm = await getDb();

    // Try to reverse in moderation_actions first
    const modRows = await orm
      .update(schema.moderationActions)
      .set({
        reversedAt: new Date(),
        reversedBy: adminId,
        reversalNote: body.note,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.moderationActions.id, body.actionId),
          sql`${schema.moderationActions.reversedAt} IS NULL`
        )
      )
      .returning({ id: schema.moderationActions.id })
      .catch(() => [] as { id: string }[]);

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
    const autoRows = await orm
      .update(schema.automatedActionsLog)
      .set({
        reversedAt: new Date(),
        reversedBy: adminId,
        reverseNote: body.note,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.automatedActionsLog.id, body.actionId),
          sql`${schema.automatedActionsLog.reversedAt} IS NULL`
        )
      )
      .returning({ id: schema.automatedActionsLog.id })
      .catch(() => [] as { id: string }[]);

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
