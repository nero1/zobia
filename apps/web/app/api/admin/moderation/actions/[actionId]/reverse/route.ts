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
import { eq, sql } from "drizzle-orm";
import { withModeratorOrAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb, schema } from "@/lib/db/drizzle";
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

    const orm = await getDb();

    const [actionRow] = await orm
      .select({
        id: schema.moderationActions.id,
        actionType: schema.moderationActions.actionType,
        actorType: schema.moderationActions.actorType,
        targetUserId: schema.moderationActions.targetUserId,
        reportId: schema.moderationActions.reportId,
        reversedAt: schema.moderationActions.reversedAt,
      })
      .from(schema.moderationActions)
      .where(eq(schema.moderationActions.id, actionId))
      .limit(1);
    const action: ModerationActionRow | undefined = actionRow
      ? {
          id: actionRow.id,
          action_type: actionRow.actionType ?? "",
          actor_type: actionRow.actorType,
          target_user_id: actionRow.targetUserId,
          report_id: actionRow.reportId,
          reversed_at: actionRow.reversedAt ? actionRow.reversedAt.toISOString() : null,
        }
      : undefined;
    if (!action) throw notFound("Moderation action not found");
    if (action.reversed_at !== null) throw badRequest("Action already reversed", "ALREADY_REVERSED");

    const requiredCap = CAPABILITY_GATED_REVERSE[action.action_type];
    if (requiredCap && !auth.isAdmin && !(await canPlatformModPerform(requiredCap))) {
      throw forbidden("Platform Mods are not currently permitted to reverse a ban or AI escalation.", "MOD_CAPABILITY_DISABLED");
    }

    let reportContent: ReportContentRow | null = null;
    if (action.report_id) {
      // NOTE: bb_post_id/bb_thread_id live on moderation_reports and are part
      // of the Drizzle schema, but this SELECT also needs the LEFT JOIN onto
      // guild_messages for the COALESCE fallback, so it stays as one `sql`
      // template rather than a builder query + separate lookup.
      const { rows: reportRows } = await orm.execute<ReportContentRow & Record<string, unknown>>(sql`
        SELECT r.reported_message_id, r.reported_guild_message_id, r.reported_forum_question_id, r.reported_forum_answer_id,
               r.reported_bb_post_id, r.reported_bb_thread_id,
               COALESCE(r.reported_guild_id, gmsg.guild_id) AS reported_guild_id
        FROM moderation_reports r
        LEFT JOIN guild_messages gmsg ON gmsg.id = r.reported_guild_message_id
        WHERE r.id = ${action.report_id}
      `);
      reportContent = reportRows[0] ?? null;
    }

    await orm.transaction(async (tx) => {
      if (action.action_type === "warn" && action.target_user_id) {
        await tx
          .update(schema.users)
          .set({ warningCount: sql`GREATEST(COALESCE(${schema.users.warningCount}, 0) - 1, 0)` })
          .where(eq(schema.users.id, action.target_user_id));
      } else if (
        (action.action_type === "suspend" || action.action_type === "suspend_user") &&
        action.target_user_id
      ) {
        await tx
          .update(schema.users)
          .set({ isSuspended: false, suspendedUntil: null })
          .where(eq(schema.users.id, action.target_user_id));
      } else if ((action.action_type === "ban" || action.action_type === "ban_user") && action.target_user_id) {
        await tx
          .update(schema.users)
          .set({ isBanned: false, bannedAt: null, bannedBy: null })
          .where(eq(schema.users.id, action.target_user_id));
      } else if (action.action_type === "remove_content" && reportContent) {
        if (reportContent.reported_message_id) {
          await tx
            .update(schema.messages)
            .set({ deletedAt: null, deletedBy: null })
            .where(eq(schema.messages.id, reportContent.reported_message_id));
        } else if (reportContent.reported_guild_message_id) {
          await tx
            .update(schema.guildMessages)
            .set({ isDeleted: false, deletedBy: null })
            .where(eq(schema.guildMessages.id, reportContent.reported_guild_message_id));
        } else if (reportContent.reported_forum_question_id) {
          await tx
            .update(schema.forumQuestions)
            .set({ deletedAt: null })
            .where(eq(schema.forumQuestions.id, reportContent.reported_forum_question_id));
        } else if (reportContent.reported_forum_answer_id) {
          await tx
            .update(schema.forumAnswers)
            .set({ deletedAt: null })
            .where(eq(schema.forumAnswers.id, reportContent.reported_forum_answer_id));
        } else if (reportContent.reported_bb_post_id) {
          // NOTE: bb_posts is not present in lib/db/schema.ts (schema/DB
          // mismatch — reported separately).
          await tx.execute(sql`UPDATE bb_posts SET deleted_at = NULL WHERE id = ${reportContent.reported_bb_post_id}`);
        } else if (reportContent.reported_bb_thread_id) {
          // NOTE: bb_threads is not present in lib/db/schema.ts (schema/DB
          // mismatch — reported separately).
          await tx.execute(sql`UPDATE bb_threads SET deleted_at = NULL WHERE id = ${reportContent.reported_bb_thread_id}`);
        }
      } else if (action.action_type === "mute_member" && action.target_user_id && reportContent?.reported_guild_id) {
        await tx
          .update(schema.guildMembers)
          .set({ isMuted: false, mutedUntil: null })
          .where(
            sql`${schema.guildMembers.guildId} = ${reportContent.reported_guild_id} AND ${schema.guildMembers.userId} = ${action.target_user_id}`
          );
      }
      // dismiss/escalate/escalate_ai/kick_member: no domain mutation to undo
      // (a kicked member must be re-invited/re-approved like anyone else).

      await tx
        .update(schema.moderationActions)
        .set({ reversedAt: new Date(), reversedBy: auth.user.sub, reversalNote: body.note ?? null })
        .where(eq(schema.moderationActions.id, actionId));

      if (action.report_id) {
        // Reversing the automated auto-quarantine action also clears the
        // auto_quarantined flag; reversing a manual action leaves it as-is.
        const clearAutoQuarantine = action.actor_type === "automated";
        await tx
          .update(schema.moderationReports)
          .set({
            status: "pending",
            resolvedAt: null,
            resolvedBy: null,
            resolutionNote: null,
            rewardApplied: false,
            isMalicious: false,
            autoQuarantined: clearAutoQuarantine
              ? false
              : sql`${schema.moderationReports.autoQuarantined}`,
          })
          .where(eq(schema.moderationReports.id, action.report_id));
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
