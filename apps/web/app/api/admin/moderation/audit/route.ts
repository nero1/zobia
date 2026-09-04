export const dynamic = 'force-dynamic';

/**
 * app/api/admin/moderation/audit/route.ts
 *
 * GET /api/admin/moderation/audit — Audit log of manual moderation activity.
 *
 * Admin-only (not moderator-visible) — this is the Moderation Center's
 * "Audit log of moderation activities accessible to admins" requirement.
 * Complements /api/admin/actions-log, which deliberately only surfaces
 * *automated* (actor_type='automated') actions; this endpoint is the manual
 * counterpart, so every human moderation decision — who took it, on whom,
 * and whether/by whom it was later reversed — is reviewable in one place.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, SqlParam } from "@/lib/db";
import { withAdminAuth, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

const querySchema = z.object({
  moderatorId: z.string().uuid().optional(),
  targetUserId: z.string().uuid().optional(),
  actionType: z.string().optional(),
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 200) : 50)),
});

interface AuditRow {
  id: string;
  action_type: string;
  reason: string | null;
  duration_hours: number | null;
  report_id: string | null;
  target_user_id: string | null;
  target_username: string | null;
  moderator_id: string | null;
  moderator_username: string | null;
  created_at: string;
  reversed_at: string | null;
  reversed_by: string | null;
  reversed_by_username: string | null;
  reversal_note: string | null;
}

export const GET = withAdminAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const query = validateSearchParams(req.nextUrl.searchParams, querySchema);

    const clauses: string[] = [`ma.actor_type = 'manual'`];
    const args: SqlParam[] = [];
    let idx = 1;

    if (query.moderatorId) {
      clauses.push(`ma.moderator_id = $${idx++}`);
      args.push(query.moderatorId);
    }
    if (query.targetUserId) {
      clauses.push(`ma.target_user_id = $${idx++}`);
      args.push(query.targetUserId);
    }
    if (query.actionType) {
      clauses.push(`ma.action_type = $${idx++}`);
      args.push(query.actionType);
    }
    if (query.cursor) {
      clauses.push(`ma.created_at < $${idx++}`);
      args.push(query.cursor);
    }
    args.push(query.limit + 1);

    const { rows } = await db.query<AuditRow>(
      `SELECT
         ma.id, ma.action_type, ma.reason, ma.duration_hours, ma.report_id,
         ma.target_user_id, target.username AS target_username,
         ma.moderator_id, mod.username AS moderator_username,
         ma.created_at,
         ma.reversed_at, ma.reversed_by, reverser.username AS reversed_by_username,
         ma.reversal_note
       FROM moderation_actions ma
       LEFT JOIN users target   ON target.id = ma.target_user_id
       LEFT JOIN users mod      ON mod.id = ma.moderator_id
       LEFT JOIN users reverser ON reverser.id = ma.reversed_by
       WHERE ${clauses.join(" AND ")}
       ORDER BY ma.created_at DESC
       LIMIT $${idx}`,
      args
    );

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]?.created_at ?? null : null;

    return NextResponse.json({
      success: true,
      data: { items, nextCursor, hasMore },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
