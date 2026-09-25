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
import { eq, sql } from "drizzle-orm";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb, schema } from "@/lib/db/drizzle";
import { deleteQuestion, deleteAnswer } from "@/lib/forum/service";
import { revokeUserAccess } from "@/lib/auth/session";

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

    const orm = await getDb();

    const [report] = await orm
      .select({
        id: schema.moderationReports.id,
        status: schema.moderationReports.status,
        reported_forum_question_id: schema.moderationReports.reportedForumQuestionId,
        reported_forum_answer_id: schema.moderationReports.reportedForumAnswerId,
        question_author_id: schema.forumQuestions.authorId,
        answer_author_id: schema.forumAnswers.authorId,
      })
      .from(schema.moderationReports)
      .leftJoin(schema.forumQuestions, eq(schema.forumQuestions.id, schema.moderationReports.reportedForumQuestionId))
      .leftJoin(schema.forumAnswers, eq(schema.forumAnswers.id, schema.moderationReports.reportedForumAnswerId))
      .where(
        sql`${schema.moderationReports.id} = ${reportId}
          AND (${schema.moderationReports.reportedForumQuestionId} IS NOT NULL
            OR ${schema.moderationReports.reportedForumAnswerId} IS NOT NULL)`
      )
      .limit(1);
    if (!report) throw notFound("Report not found");
    if (report.status !== "pending") throw badRequest(`Report is already ${report.status}`);

    const targetUserId = report.question_author_id ?? report.answer_author_id ?? null;

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

      await tx.insert(schema.forumModerationLog).values({
        moderatorId: auth.user.sub,
        questionId: report.reported_forum_question_id,
        answerId: report.reported_forum_answer_id,
        targetUserId,
        action,
        reason: note ?? null,
      });

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
      if (report.reported_forum_question_id) {
        await deleteQuestion(report.reported_forum_question_id, auth.user.sub, true).catch(() => {});
      } else if (report.reported_forum_answer_id) {
        await deleteAnswer(report.reported_forum_answer_id, auth.user.sub, true).catch(() => {});
      }
    }

    if (targetUserId && (action === "ban_user" || action === "suspend_user")) {
      await revokeUserAccess(targetUserId, "forum_moderation");
    }

    return NextResponse.json({ success: true, data: { reportId, action }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
