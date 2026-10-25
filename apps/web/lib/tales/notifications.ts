import { z } from "zod";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import {
  enqueueTask,
  PermanentTaskError,
  type DurableTask,
} from "@/lib/tasks/outbox";
import { insertNotificationBatch } from "@/lib/notifications/insert";
const payload = z.object({
  chapterId: z.string().uuid(),
  cutoff: z.string().datetime(),
  cursor: z.string().uuid().optional(),
});
/** One transaction sends at most 500 notifications and durably schedules its
 * continuation. Stable chapter references make retries safe after a lost ack. */
export async function deliverTaleNotifications(task: DurableTask) {
  const parsed = payload.safeParse(task.payload);
  if (!parsed.success) throw new PermanentTaskError("InvalidTaleNotification");
  const input = parsed.data,
    db = await getDb();
  await db.transaction(async (tx) => {
    const result = await tx.execute<{
      id: string;
      title: string;
      ordinal: number;
      slug: string;
      author_id: string;
    }>(
      sql`SELECT c.id,c.title,c.ordinal,t.slug,t.author_id FROM tale_chapters c JOIN tales t ON t.id=c.tale_id JOIN users u ON u.id=t.author_id WHERE c.id=${input.chapterId} AND t.author_id=${task.user_id} AND c.status='published' AND c.moderation='approved' AND (c.publish_at IS NULL OR c.publish_at<=NOW()) AND t.status='published' AND t.moderation='approved' AND t.notify_subscribers AND u.deleted_at IS NULL AND NOT u.is_banned AND NOT(COALESCE(u.is_suspended,FALSE) AND (u.suspended_until IS NULL OR u.suspended_until>NOW())) AND NOT EXISTS(SELECT 1 FROM tale_account_restrictions ar WHERE ar.user_id=u.id AND ar.state IN ('banned','suspended') AND (ar.expires_at IS NULL OR ar.expires_at>NOW()))`,
    );
    const chapter = result.rows[0];
    if (!chapter) return;
    const subscribers = await tx.execute<{ user_id: string }>(
      sql`SELECT s.user_id FROM tale_author_subscriptions s JOIN users u ON u.id=s.user_id WHERE s.author_id=${chapter.author_id} AND s.created_at<=${input.cutoff}::timestamptz AND (${input.cursor ?? null}::uuid IS NULL OR s.user_id>${input.cursor ?? null}::uuid) AND u.deleted_at IS NULL AND NOT u.is_banned ORDER BY s.user_id LIMIT 501`,
    );
    const page = subscribers.rows.slice(0, 500);
    await insertNotificationBatch(
      tx,
      page.map((r) => r.user_id),
      "tale_new_chapter",
      "New chapter",
      chapter.title,
      { taleSlug: chapter.slug, ordinal: chapter.ordinal },
      chapter.id,
    );
    if (subscribers.rows.length > 500) {
      const cursor = page.at(-1)!.user_id;
      await enqueueTask(
        tx,
        "tale_notifications",
        `tale-chapter:${chapter.id}:${cursor}`,
        chapter.author_id,
        { ...input, cursor },
      );
    }
  });
}
