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
import { canPlatformModPerform } from "@/lib/moderation/capabilities";

const reverseActionSchema = z.object({
  note: z.string().max(500).optional(),
});

/** Reversing ban/escalate requires the SAME capability as taking the action forward — a mod granted ban_user may also undo their own ban. Admins always may. */
const CAPABILITY_GATED_REVERSE: Record<string, string> = {
  ban: "ban_user",
  ban_user: "ban_user",
  escalate: "escalate_ai",
  escalate_ai: "escalate_ai",
};

interface ModerationActionRow {
  id: string;
  action_type: string;
  actor_type: string;
  target_user_id: string | null;
  report_id: string | null;
  reversed_at: string | null;
}

interface ReportContentRow {
  reported_message_id: string | null;
  reported_guild_message_id: string | null;
  reported_forum_question_id: string | null;
  reported_forum_answer_id: string | null;
  reported_bb_post_id: string | null;
  reported_bb_thread_id: string | null;
  reported_guild_id: string | null;
}

export const POST = withModeratorOrAdminAuth<{ actionId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { actionId } = await params;
    const body = await validateBody(req, reverseActionSchema);

    const { rows } = await db.query<ModerationActionRow>(
      `SELECT id, action_type, actor_type, target_user_id, report_id, reversed_at
       FROM moderation_actions
       WHERE id = $1`,
      [actionId]
    );
    const action = rows[0];
    if (!action) throw notFound("Moderation action not found");
    if (action.reversed_at !== null) throw badRequest("Action already reversed", "ALREADY_REVERSED");

    const requiredCap = CAPABILITY_GATED_REVERSE[action.action_type];
    if (requiredCap && !auth.isAdmin && !(await canPlatformModPerform(requiredCap))) {
      throw forbidden("Platform Mods are not currently permitted to reverse a ban or AI escalation.", "MOD_CAPABILITY_DISABLED");
    }

    let reportContent: ReportContentRow | null = null;
    if (action.report_id) {
      const { rows: reportRows } = await db.query<ReportContentRow>(
        `SELECT r.reported_message_id, r.reported_guild_message_id, r.reported_forum_question_id, r.reported_forum_answer_id,
                r.reported_bb_post_id, r.reported_bb_thread_id,
                COALESCE(r.reported_guild_id, gmsg.guild_id) AS reported_guild_id
         FROM moderation_reports r
         LEFT JOIN guild_messages gmsg ON gmsg.id = r.reported_guild_message_id
         WHERE r.id = $1`,
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
        } else if (reportContent.reported_guild_message_id) {
          await tx.query(
            `UPDATE guild_messages SET is_deleted = false, deleted_by = NULL WHERE id = $1`,
            [reportContent.reported_guild_message_id]
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
        } else if (reportContent.reported_bb_post_id) {
          await tx.query(`UPDATE bb_posts SET deleted_at = NULL WHERE id = $1`, [reportContent.reported_bb_post_id]);
        } else if (reportContent.reported_bb_thread_id) {
          await tx.query(`UPDATE bb_threads SET deleted_at = NULL WHERE id = $1`, [reportContent.reported_bb_thread_id]);
        }
      } else if (action.action_type === "mute_member" && action.target_user_id && reportContent?.reported_guild_id) {
        await tx.query(
          `UPDATE guild_members SET is_muted = false, muted_until = NULL WHERE guild_id = $1 AND user_id = $2`,
          [reportContent.reported_guild_id, action.target_user_id]
        );
      }
      // dismiss/escalate/escalate_ai/kick_member: no domain mutation to undo
      // (a kicked member must be re-invited/re-approved like anyone else).

      await tx.query(
        `UPDATE moderation_actions
         SET reversed_at = NOW(), reversed_by = $1, reversal_note = $2
         WHERE id = $3`,
        [auth.user.sub, body.note ?? null, actionId]
      );

      if (action.report_id) {
        // Reversing the automated auto-quarantine action also clears the
        // auto_quarantined flag; reversing a manual action leaves it as-is.
        const clearAutoQuarantine = action.actor_type === "automated";
        await tx.query(
          `UPDATE moderation_reports
           SET status = 'pending', resolved_at = NULL, resolved_by = NULL, resolution_note = NULL,
               reward_applied = false, is_malicious = false,
               auto_quarantined = CASE WHEN $2 THEN false ELSE auto_quarantined END
           WHERE id = $1`,
          [action.report_id, clearAutoQuarantine]
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
