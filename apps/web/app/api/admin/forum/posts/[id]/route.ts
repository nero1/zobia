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
import { withModeratorOrAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { db } from "@/lib/db";
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

    if (body.action === "hard_delete") {
      // Permanent, irreversible row deletion (distinct from "remove", which is a
      // soft status flip). Admin-only, requires explicit confirmation client-side.
      if (body.targetType === "question") {
        const { rowCount } = await db.query(`DELETE FROM forum_questions WHERE id = $1`, [id]);
        if (!rowCount) throw notFound("Not found");
      } else {
        const { rows } = await db.query<{ question_id: string }>(
          `DELETE FROM forum_answers WHERE id = $1 RETURNING question_id`,
          [id]
        );
        if (!rows[0]) throw notFound("Not found");
        await db.query(
          `UPDATE forum_questions SET answer_count = GREATEST(answer_count - 1, 0) WHERE id = $1`,
          [rows[0].question_id]
        );
      }
    } else if (body.action === "remove") {
      if (body.targetType === "question") await deleteQuestion(id, auth.user.sub, true);
      else await deleteAnswer(id, auth.user.sub, true);
    } else if (body.action === "restore") {
      const table = body.targetType === "question" ? "forum_questions" : "forum_answers";
      const { rowCount } = await db.query(
        `UPDATE ${table} SET status = 'visible', deleted_at = NULL, updated_at = NOW() WHERE id = $1`,
        [id]
      );
      if (!rowCount) throw notFound("Not found");
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
        const { rowCount } = await db.query(
          `UPDATE forum_questions
           SET title = COALESCE($2, title), body = $3, updated_at = NOW()
           WHERE id = $1`,
          [id, body.title?.trim() || null, body.body.trim()]
        );
        if (!rowCount) throw notFound("Not found");
      } else {
        const { rowCount } = await db.query(
          `UPDATE forum_answers SET body = $2, updated_at = NOW() WHERE id = $1`,
          [id, body.body.trim()]
        );
        if (!rowCount) throw notFound("Not found");
      }
    }

    // hard_delete removes the row this log would otherwise FK-reference (ON
    // DELETE CASCADE), so keep the id in metadata instead of question_id/answer_id.
    if (body.action === "hard_delete") {
      await db.query(
        `INSERT INTO forum_moderation_log (moderator_id, action, metadata, created_at)
         VALUES ($1, $2, $3::jsonb, NOW())`,
        [auth.user.sub, body.action, JSON.stringify({ targetType: body.targetType, targetId: id })]
      );
    } else {
      await db.query(
        `INSERT INTO forum_moderation_log (moderator_id, question_id, answer_id, action, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [
          auth.user.sub,
          body.targetType === "question" ? id : null,
          body.targetType === "answer" ? id : null,
          body.action,
        ]
      );
    }

    return NextResponse.json({ success: true, data: { id, action: body.action }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
