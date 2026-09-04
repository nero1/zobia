export const dynamic = 'force-dynamic';

/**
 * app/api/admin/moderation/actions/[actionId]/reverse/route.ts
 *
 * POST /api/admin/moderation/actions/:actionId/reverse
 *
 * Reverses a manual moderation action recorded in `moderation_actions` —
 * the shared audit trail both the general report queue
 * (app/api/admin/moderation/[reportId]/action) and the forum queue
 * (app/api/admin/forum/queue/[reportId]/action) write to. This is the
 * "Moderators can reverse/edit actions taken" requirement for the
 * Moderation Center: any mod/admin can undo a report resolution (warn,
 * suspend, remove content), and — mirroring the forward action's own
 * split — only an admin may reverse a ban or an AI escalation.
 *
 * Reversal effects by action_type:
 *   - warn                  → decrement warning_count (floor 0)
 *   - suspend / suspend_user → clear is_suspended / suspended_until
 *   - ban / ban_user         → clear is_banned / banned_at / banned_by (admin only)
 *   - remove_content         → restore the message or forum question/answer
 *   - dismiss / escalate*    → no domain mutation; just marks reversed
 *
 * The originating report is reset to `pending` (resolved_at/resolved_by/
 * resolution_note cleared) so it re-enters the queue for re-review.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withModeratorOrAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";

const reverseActionSchema = z.object({
  note: z.string().max(500).optional(),
});

const ADMIN_ONLY_REVERSE = new Set(["ban", "ban_user", "escalate", "escalate_ai"]);

interface ModerationActionRow {
  id: string;
  action_type: string;
  target_user_id: string | null;
  report_id: string | null;
  reversed_at: string | null;
}

interface ReportContentRow {
  reported_message_id: string | null;
  reported_forum_question_id: string | null;
  reported_forum_answer_id: string | null;
}

export const POST = withModeratorOrAdminAuth<{ actionId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { actionId } = await params;
    const body = await validateBody(req, reverseActionSchema);

    const { rows } = await db.query<ModerationActionRow>(
      `SELECT id, action_type, target_user_id, report_id, reversed_at
       FROM moderation_actions
       WHERE id = $1`,
      [actionId]
    );
    const action = rows[0];
    if (!action) throw notFound("Moderation action not found");
    if (action.reversed_at !== null) throw badRequest("Action already reversed", "ALREADY_REVERSED");

    if (ADMIN_ONLY_REVERSE.has(action.action_type) && !auth.isAdmin) {
      throw forbidden("Only administrators can reverse a ban or AI escalation.", "ADMIN_ONLY_ACTION");
    }

    let reportContent: ReportContentRow | null = null;
    if (action.report_id) {
      const { rows: reportRows } = await db.query<ReportContentRow>(
        `SELECT reported_message_id, reported_forum_question_id, reported_forum_answer_id
         FROM moderation_reports WHERE id = $1`,
        [action.report_id]
      );
      reportContent = reportRows[0] ?? null;
    }

    await db.transaction(async (tx) => {
      if (action.action_type === "warn" && action.target_user_id) {
        await tx.query(
          `UPDATE users SET warning_count = GREATEST(COALESCE(warning_count, 0) - 1, 0) WHERE id = $1`,
          [action.target_user_id]
        );
      } else if (
        (action.action_type === "suspend" || action.action_type === "suspend_user") &&
        action.target_user_id
      ) {
        await tx.query(
          `UPDATE users SET is_suspended = false, suspended_until = NULL WHERE id = $1`,
          [action.target_user_id]
        );
      } else if ((action.action_type === "ban" || action.action_type === "ban_user") && action.target_user_id) {
        await tx.query(
          `UPDATE users SET is_banned = false, banned_at = NULL, banned_by = NULL WHERE id = $1`,
          [action.target_user_id]
        );
      } else if (action.action_type === "remove_content" && reportContent) {
        if (reportContent.reported_message_id) {
          await tx.query(
            `UPDATE messages SET deleted_at = NULL, deleted_by = NULL WHERE id = $1`,
            [reportContent.reported_message_id]
          );
        } else if (reportContent.reported_forum_question_id) {
          await tx.query(
            `UPDATE forum_questions SET deleted_at = NULL WHERE id = $1`,
            [reportContent.reported_forum_question_id]
          );
        } else if (reportContent.reported_forum_answer_id) {
          await tx.query(
            `UPDATE forum_answers SET deleted_at = NULL WHERE id = $1`,
            [reportContent.reported_forum_answer_id]
          );
        }
      }
      // dismiss/escalate/escalate_ai: no domain mutation to undo.

      await tx.query(
        `UPDATE moderation_actions
         SET reversed_at = NOW(), reversed_by = $1, reversal_note = $2
         WHERE id = $3`,
        [auth.user.sub, body.note ?? null, actionId]
      );

      if (action.report_id) {
        await tx.query(
          `UPDATE moderation_reports
           SET status = 'pending', resolved_at = NULL, resolved_by = NULL, resolution_note = NULL
           WHERE id = $1`,
          [action.report_id]
        );
      }
    });

    return NextResponse.json({
      success: true,
      data: { actionId, reversedAt: new Date().toISOString() },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
