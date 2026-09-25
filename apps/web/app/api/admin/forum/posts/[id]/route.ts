export const dynamic = "force-dynamic";

/**
 * app/api/admin/forum/posts/[id]/route.ts
 *
 * PATCH /api/admin/forum/posts/:id — { targetType: 'question'|'answer', action }
 *   actions: remove | restore | lock | unlock (lock/unlock are question-only)
 *
 * `restore`/`lock`/`unlock` require admin (not just moderator) since they
 * reverse a moderation decision or change platform-wide post behavior;
 * `remove` is available to both, matching the queue action's remove_content.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getDb, schema } from "@/lib/db/drizzle";
import { deleteQuestion, deleteAnswer, setQuestionLocked } from "@/lib/forum/service";

const bodySchema = z.object({
  targetType: z.enum(["question", "answer"]),
  action: z.enum(["remove", "restore", "lock", "unlock", "edit", "hard_delete"]),
  // Only used when action === "edit". Title is question-only.
  title: z.string().min(3).max(200).optional(),
  body: z.string().min(1).max(10000).optional(),
});

const ADMIN_ONLY_ACTIONS = new Set(["restore", "lock", "unlock", "hard_delete"]);

export const PATCH = withModeratorOrAdminAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    const { id } = await params;
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) throw badRequest("Invalid request body", parsed.error.flatten());
    const body = parsed.data;

    if (ADMIN_ONLY_ACTIONS.has(body.action) && !auth.isAdmin) {
      throw forbidden("Only administrators can perform this action.", "ADMIN_ONLY_ACTION");
    }

    const orm = await getDb();

    if (body.action === "hard_delete") {
      // Permanent, irreversible row deletion (distinct from "remove", which is a
      // soft status flip). Admin-only, requires explicit confirmation client-side.
      if (body.targetType === "question") {
        const deleted = await orm
          .delete(schema.forumQuestions)
          .where(eq(schema.forumQuestions.id, id))
          .returning({ id: schema.forumQuestions.id });
        if (deleted.length === 0) throw notFound("Not found");
      } else {
        const [deletedAnswer] = await orm
          .delete(schema.forumAnswers)
          .where(eq(schema.forumAnswers.id, id))
          .returning({ questionId: schema.forumAnswers.questionId });
        if (!deletedAnswer) throw notFound("Not found");
        await orm
          .update(schema.forumQuestions)
          .set({ answerCount: sql`GREATEST(${schema.forumQuestions.answerCount} - 1, 0)` })
          .where(eq(schema.forumQuestions.id, deletedAnswer.questionId));
      }
    } else if (body.action === "remove") {
      if (body.targetType === "question") await deleteQuestion(id, auth.user.sub, true);
      else await deleteAnswer(id, auth.user.sub, true);
    } else if (body.action === "restore") {
      if (body.targetType === "question") {
        const restored = await orm
          .update(schema.forumQuestions)
          .set({ status: "visible", deletedAt: null, updatedAt: new Date() })
          .where(eq(schema.forumQuestions.id, id))
          .returning({ id: schema.forumQuestions.id });
        if (restored.length === 0) throw notFound("Not found");
      } else {
        const restored = await orm
          .update(schema.forumAnswers)
          .set({ status: "visible", deletedAt: null, updatedAt: new Date() })
          .where(eq(schema.forumAnswers.id, id))
          .returning({ id: schema.forumAnswers.id });
        if (restored.length === 0) throw notFound("Not found");
      }
    } else if (body.action === "lock") {
      if (body.targetType !== "question") throw badRequest("Only questions can be locked");
      await setQuestionLocked(id, true);
    } else if (body.action === "unlock") {
      if (body.targetType !== "question") throw badRequest("Only questions can be locked");
      await setQuestionLocked(id, false);
    } else if (body.action === "edit") {
      // Mods and admins can both edit content (unlike restore/lock, which
      // reverse a moderation decision — editing is a content correction).
      if (!body.body?.trim()) throw badRequest("Body is required");
      if (body.targetType === "question") {
        const updates: Partial<typeof schema.forumQuestions.$inferInsert> = {
          body: body.body.trim(),
          updatedAt: new Date(),
        };
        if (body.title?.trim()) updates.title = body.title.trim();
        const updated = await orm
          .update(schema.forumQuestions)
          .set(updates)
          .where(eq(schema.forumQuestions.id, id))
          .returning({ id: schema.forumQuestions.id });
        if (updated.length === 0) throw notFound("Not found");
      } else {
        const updated = await orm
          .update(schema.forumAnswers)
          .set({ body: body.body.trim(), updatedAt: new Date() })
          .where(eq(schema.forumAnswers.id, id))
          .returning({ id: schema.forumAnswers.id });
        if (updated.length === 0) throw notFound("Not found");
      }
    }

    // hard_delete removes the row this log would otherwise FK-reference (ON
    // DELETE CASCADE), so keep the id in metadata instead of question_id/answer_id.
    if (body.action === "hard_delete") {
      await orm.insert(schema.forumModerationLog).values({
        moderatorId: auth.user.sub,
        action: body.action,
        metadata: { targetType: body.targetType, targetId: id },
      });
    } else {
      await orm.insert(schema.forumModerationLog).values({
        moderatorId: auth.user.sub,
        questionId: body.targetType === "question" ? id : null,
        answerId: body.targetType === "answer" ? id : null,
        action: body.action,
      });
    }

    return NextResponse.json({ success: true, data: { id, action: body.action }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
