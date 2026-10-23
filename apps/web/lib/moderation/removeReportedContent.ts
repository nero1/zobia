import { eq } from "drizzle-orm";
import { schema, type DbOrTx } from "@/lib/db/drizzle";
import { badRequest } from "@/lib/api/errors";
export interface ReportContentTarget {
  reported_tale_id?: string | null;
  reported_tale_chapter_id?: string | null;
  reported_message_id?: string | null;
  reported_guild_message_id?: string | null;
  reported_bb_thread_id?: string | null;
  reported_bb_post_id?: string | null;
  reported_forum_question_id?: string | null;
  reported_forum_answer_id?: string | null;
}
/** Same target priority as report clustering; resolving a report must actually remove its content. */
export async function removeReportedContent(
  tx: DbOrTx,
  target: ReportContentTarget,
  staffId: string,
  note?: string,
) {
  if (target.reported_tale_chapter_id)
    await tx
      .update(schema.taleChapters)
      .set({
        moderation: "rejected",
        moderationReason:
          note || "Removed after staff review of a reader report.",
      })
      .where(eq(schema.taleChapters.id, target.reported_tale_chapter_id));
  else if (target.reported_tale_id)
    await tx
      .update(schema.tales)
      .set({
        moderation: "rejected",
        moderationReason:
          note || "Removed after staff review of a reader report.",
      })
      .where(eq(schema.tales.id, target.reported_tale_id));
  else if (target.reported_message_id)
    await tx
      .update(schema.messages)
      .set({ deletedAt: new Date(), deletedBy: staffId })
      .where(eq(schema.messages.id, target.reported_message_id));
  else if (target.reported_guild_message_id)
    await tx
      .update(schema.guildMessages)
      .set({ isDeleted: true, deletedBy: staffId })
      .where(eq(schema.guildMessages.id, target.reported_guild_message_id));
  else if (target.reported_bb_post_id)
    await tx
      .update(schema.bbPosts)
      .set({ deletedAt: new Date() })
      .where(eq(schema.bbPosts.id, target.reported_bb_post_id));
  else if (target.reported_bb_thread_id)
    await tx
      .update(schema.bbThreads)
      .set({ deletedAt: new Date() })
      .where(eq(schema.bbThreads.id, target.reported_bb_thread_id));
  else if (target.reported_forum_answer_id)
    await tx
      .update(schema.forumAnswers)
      .set({ deletedAt: new Date(), status: "removed" })
      .where(eq(schema.forumAnswers.id, target.reported_forum_answer_id));
  else if (target.reported_forum_question_id)
    await tx
      .update(schema.forumQuestions)
      .set({ deletedAt: new Date(), status: "removed" })
      .where(eq(schema.forumQuestions.id, target.reported_forum_question_id));
  else throw badRequest("This report has no supported content to remove.");
}
