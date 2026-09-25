export const dynamic = "force-dynamic";

/**
 * app/api/admin/bbforum/queue/[reportId]/action/route.ts
 *
 * POST /api/admin/bbforum/queue/:reportId/action — take a forum moderation action.
 *
 * Actions: dismiss | warn | remove_content | suspend_user | ban_user
 * `ban_user` is admin-only. Logs to moderation_actions (shared audit trail,
 * same as the general moderation queue and the Answers forum queue).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb, schema } from "@/lib/db/drizzle";
import { deletePost } from "@/lib/bbforum/service";
import { revokeUserAccess } from "@/lib/auth/session";

const ActionBodySchema = z.object({
  action: z.enum(["dismiss", "warn", "remove_content", "suspend_user", "ban_user"]),
  note: z.string().max(500).optional(),
  duration_hours: z.number().int().positive().optional(),
});

const ADMIN_ONLY_ACTIONS = new Set(["ban_user"]);

interface ReportRow {
  id: string;
  status: string;
  reported_bb_thread_id: string | null;
  reported_bb_post_id: string | null;
  thread_author_id: string | null;
  post_author_id: string | null;
  thread_op_post_id: string | null;
}

export const POST = withModeratorOrAdminAuth<{ reportId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { reportId } = await params;

    const body = await req.json().catch(() => ({}));
    const parsed = ActionBodySchema.safeParse(body);
    if (!parsed.success) throw badRequest("Invalid action payload", parsed.error.flatten());
    const { action, note, duration_hours } = parsed.data;

    if (ADMIN_ONLY_ACTIONS.has(action) && !auth.isAdmin) {
      throw forbidden("Only administrators can permanently ban a user.", "ADMIN_ONLY_ACTION");
    }
    if (action === "suspend_user" && !duration_hours) {
      throw badRequest("duration_hours is required for suspend_user");
    }

    const orm = await getDb();

    // NOTE: bb_threads/bb_posts are not present in lib/db/schema.ts (schema/DB
    // mismatch — reported separately), so this query is expressed via the
    // `sql` template rather than the Drizzle query builder.
    const { rows } = await orm.execute<ReportRow & Record<string, unknown>>(sql`
      SELECT r.id, r.status, r.reported_bb_thread_id, r.reported_bb_post_id,
             t.author_id AS thread_author_id, p.author_id AS post_author_id,
             (SELECT id FROM bb_posts WHERE thread_id = t.id AND is_op = true LIMIT 1) AS thread_op_post_id
      FROM moderation_reports r
      LEFT JOIN bb_threads t ON t.id = r.reported_bb_thread_id
      LEFT JOIN bb_posts p ON p.id = r.reported_bb_post_id
      WHERE r.id = ${reportId}
        AND (r.reported_bb_thread_id IS NOT NULL OR r.reported_bb_post_id IS NOT NULL)
      LIMIT 1
    `);
    const report = rows[0];
    if (!report) throw notFound("Report not found");
    if (report.status !== "pending") throw badRequest(`Report is already ${report.status}`);

    const targetUserId = report.thread_author_id ?? report.post_author_id ?? null;

    await orm.transaction(async (tx) => {
      await tx.insert(schema.moderationActions).values({
        reportId,
        targetUserId,
        actionType: action,
        reason: note ?? null,
        durationHours: duration_hours ?? null,
        moderatorId: auth.user.sub,
      });

      await tx
        .update(schema.moderationReports)
        .set({
          status: action === "dismiss" ? "dismissed" : "resolved",
          resolvedAt: new Date(),
          resolvedBy: auth.user.sub,
          resolutionNote: note ?? null,
        })
        .where(eq(schema.moderationReports.id, reportId));

      if (targetUserId) {
        if (action === "warn") {
          await tx
            .update(schema.users)
            .set({ warningCount: sql`COALESCE(${schema.users.warningCount}, 0) + 1` })
            .where(eq(schema.users.id, targetUserId));
        } else if (action === "suspend_user" && duration_hours) {
          const suspendUntil = new Date(Date.now() + duration_hours * 60 * 60 * 1000);
          await tx
            .update(schema.users)
            .set({ suspendedUntil: suspendUntil, isSuspended: true })
            .where(eq(schema.users.id, targetUserId));
        } else if (action === "ban_user") {
          await tx
            .update(schema.users)
            .set({ isBanned: true, bannedAt: new Date(), bannedBy: auth.user.sub })
            .where(eq(schema.users.id, targetUserId));
        }
      }
    });

    if (action === "remove_content") {
      const targetPostId = report.reported_bb_post_id ?? report.thread_op_post_id;
      if (targetPostId) {
        await deletePost(targetPostId, auth.user.sub, true).catch(() => {});
      }
    }

    if (targetUserId && (action === "ban_user" || action === "suspend_user")) {
      await revokeUserAccess(targetUserId, "bbforum_moderation");
    }

    return NextResponse.json({ success: true, data: { reportId, action }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
