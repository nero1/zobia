import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { raiseAlert } from "@/lib/alerts/dispatch";
export async function queueRestoreEmail(userId: string) {
  const db = await getDb();
  await db.execute(
    sql`INSERT INTO restore_email_tasks(user_id) VALUES (${userId}) ON CONFLICT(user_id) DO UPDATE SET attempts=0,available_at=NOW(),lease_token=NULL,delivered_at=NULL,updated_at=NOW() WHERE restore_email_tasks.updated_at<NOW()-INTERVAL '15 minutes'`,
  );
}
export async function processRestoreEmail(userId: string) {
  const db = await getDb(),
    lease = randomUUID();
  const claimed = await db.execute<{ attempts: number }>(
    sql`UPDATE restore_email_tasks SET attempts=attempts+1,lease_token=${lease},available_at=NOW()+INTERVAL '2 minutes' WHERE user_id=${userId} AND delivered_at IS NULL AND attempts<5 AND available_at<=NOW() RETURNING attempts`,
  );
  if (!claimed.rows.length) return;
  try {
    const { deliverAccountRestoreEmail } = await import("@/lib/auth/restore");
    await deliverAccountRestoreEmail(userId);
    await db.execute(
      sql`UPDATE restore_email_tasks SET delivered_at=NOW(),updated_at=NOW(),lease_token=NULL WHERE user_id=${userId} AND lease_token=${lease}`,
    );
  } catch (error) {
    const delay = Math.round(
      Math.min(3600, 30 * 2 ** claimed.rows[0].attempts) *
        (0.8 + Math.random() * 0.4),
    );
    await db.execute(
      sql`UPDATE restore_email_tasks SET available_at=NOW()+(${delay}*INTERVAL '1 second'),lease_token=NULL,updated_at=NOW() WHERE user_id=${userId} AND lease_token=${lease}`,
    );
    throw error;
  }
}
export async function retryRestoreEmails() {
  const db = await getDb();
  const due = await db.execute<{ user_id: string }>(
    sql`SELECT user_id FROM restore_email_tasks WHERE delivered_at IS NULL AND attempts<5 AND available_at<=NOW() LIMIT 50`,
  );
  for (const row of due.rows)
    try {
      await processRestoreEmail(row.user_id);
    } catch {
      /* Durable retries remain pending. */
    }
  const depth = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int n FROM restore_email_tasks WHERE delivered_at IS NULL AND attempts>=5`,
  );
  if (depth.rows[0].n)
    await raiseAlert(db, {
      type: "restore_email_dlq",
      category: "security",
      priorityLevel: 2,
      title: "Account recovery delivery needs attention",
      message: `${depth.rows[0].n} recovery messages exhausted retries.`,
      dedupeKey: "restore-email:dlq",
    });
  await db.execute(
    sql`DELETE FROM restore_email_tasks WHERE delivered_at<NOW()-INTERVAL '7 days'`,
  );
  return { attempted: due.rows.length, dead: depth.rows[0].n };
}
