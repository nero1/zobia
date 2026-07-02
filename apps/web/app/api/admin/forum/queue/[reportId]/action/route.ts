export const dynamic = "force-dynamic";

/**
 * app/api/admin/forum/queue/[reportId]/action/route.ts
 *
 * POST /api/admin/forum/queue/:reportId/action — Take a forum moderation action.
 *
 * Actions: dismiss | warn | remove_content | suspend_user | ban_user
 * `ban_user` is admin-only (mirrors the adminOnlyActions split used by the
 * room admin API) — moderators can dismiss/warn/remove content/suspend.
 *
 * Logs to moderation_actions (shared audit trail, same as the general
 * moderation queue) AND forum_moderation_log (forum-specific trail).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";
import { deleteQuestion, deleteAnswer } from "@/lib/forum/service";
import { invalidateAllSessions } from "@/lib/auth/session";

const ActionBodySchema = z.object({
  action: z.enum(["dismiss", "warn", "remove_content", "suspend_user", "ban_user"]),
  note: z.string().max(500).optional(),
  duration_hours: z.number().int().positive().optional(),
});

const ADMIN_ONLY_ACTIONS = new Set(["ban_user"]);

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

    const { rows } = await db.query<{
      id: string;
      status: string;
      reported_forum_question_id: string | null;
      reported_forum_answer_id: string | null;
      question_author_id: string | null;
      answer_author_id: string | null;
    }>(
      `SELECT r.id, r.status, r.reported_forum_question_id, r.reported_forum_answer_id,
              q.author_id AS question_author_id, a.author_id AS answer_author_id
       FROM moderation_reports r
       LEFT JOIN forum_questions q ON q.id = r.reported_forum_question_id
       LEFT JOIN forum_answers a ON a.id = r.reported_forum_answer_id
       WHERE r.id = $1
         AND (r.reported_forum_question_id IS NOT NULL OR r.reported_forum_answer_id IS NOT NULL)
       LIMIT 1`,
      [reportId]
    );
    const report = rows[0];
    if (!report) throw notFound("Report not found");
    if (report.status !== "pending") throw badRequest(`Report is already ${report.status}`);

    const targetUserId = report.question_author_id ?? report.answer_author_id ?? null;

    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO moderation_actions
           (report_id, target_user_id, action_type, reason, duration_hours, moderator_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [reportId, targetUserId, action, note ?? null, duration_hours ?? null, auth.user.sub]
      );

      await tx.query(
        `UPDATE moderation_reports
         SET status = $1, resolved_at = NOW(), resolved_by = $2, resolution_note = $3
         WHERE id = $4`,
        [action === "dismiss" ? "dismissed" : "resolved", auth.user.sub, note ?? null, reportId]
      );

      await tx.query(
        `INSERT INTO forum_moderation_log
           (moderator_id, question_id, answer_id, target_user_id, action, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          auth.user.sub,
          report.reported_forum_question_id,
          report.reported_forum_answer_id,
          targetUserId,
          action,
          note ?? null,
        ]
      );

      if (targetUserId) {
        if (action === "warn") {
          await tx.query(`UPDATE users SET warning_count = COALESCE(warning_count, 0) + 1 WHERE id = $1`, [targetUserId]);
        } else if (action === "suspend_user" && duration_hours) {
          const suspendUntil = new Date(Date.now() + duration_hours * 60 * 60 * 1000).toISOString();
          await tx.query(`UPDATE users SET suspended_until = $1, is_suspended = true WHERE id = $2`, [suspendUntil, targetUserId]);
        } else if (action === "ban_user") {
          await tx.query(`UPDATE users SET is_banned = true, banned_at = NOW(), banned_by = $1 WHERE id = $2`, [auth.user.sub, targetUserId]);
        }
      }
    });

    if (action === "remove_content") {
      if (report.reported_forum_question_id) {
        await deleteQuestion(report.reported_forum_question_id, auth.user.sub, true).catch(() => {});
      } else if (report.reported_forum_answer_id) {
        await deleteAnswer(report.reported_forum_answer_id, auth.user.sub, true).catch(() => {});
      }
    }

    if (targetUserId && (action === "ban_user" || action === "suspend_user")) {
      await invalidateAllSessions(targetUserId).catch(() => {});
    }

    return NextResponse.json({ success: true, data: { reportId, action }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
