import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/lib/db/drizzle";
import { storage } from "./index";
import { storageKey } from "./privacy";
import { raiseAlert } from "@/lib/alerts/dispatch";
export async function queueObjectDeletion(
  tx: DbOrTx,
  key: string,
  delaySeconds = 0,
) {
  storageKey(key);
  await tx.execute(
    sql`INSERT INTO object_deletion_tasks(storage_key,available_at) VALUES (${key},NOW()+(${delaySeconds}*INTERVAL '1 second')) ON CONFLICT(storage_key) DO UPDATE SET available_at=LEAST(object_deletion_tasks.available_at,EXCLUDED.available_at)`,
  );
}
export async function drainObjectDeletions() {
  const db = await getDb();
  let removed = 0;
  // Detached identity uploads are deliberately short lived.
  await db.transaction(async (tx) => {
    const old = await tx.execute<{ storage_key: string }>(
      sql`DELETE FROM kyc_documents WHERE id IN (SELECT id FROM kyc_documents WHERE submission_id IS NULL AND created_at<NOW()-INTERVAL '24 hours' LIMIT 100 FOR UPDATE SKIP LOCKED) RETURNING storage_key`,
    );
    for (const row of old.rows) await queueObjectDeletion(tx, row.storage_key);
  });
  for (let i = 0; i < 50; i++) {
    const token = randomUUID();
    const claim = await db.execute<{
      id: string;
      storage_key: string;
      attempts: number;
    }>(
      sql`UPDATE object_deletion_tasks SET attempts=attempts+1,lease_token=${token},available_at=NOW()+INTERVAL '2 minutes' WHERE id=(SELECT id FROM object_deletion_tasks WHERE available_at<=NOW() AND attempts<10 ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,storage_key,attempts`,
    );
    const task = claim.rows[0];
    if (!task) break;
    try {
      // Upload reservations are removed transactionally only once publication succeeds.
      const live = await db.execute(
        sql`SELECT id FROM kyc_documents WHERE storage_key=${task.storage_key} AND (submission_id IS NOT NULL OR upload_state='ready') LIMIT 1`,
      );
      if (live.rows.length) {
        await db.execute(
          sql`DELETE FROM object_deletion_tasks WHERE id=${task.id} AND lease_token=${token}`,
        );
        continue;
      }
      await storage.delete(task.storage_key, { ignoreNotFound: true });
      await db.execute(
        sql`DELETE FROM object_deletion_tasks WHERE id=${task.id} AND lease_token=${token}`,
      );
      removed++;
    } catch (error) {
      const delay =
        Math.min(86400, 60 * 2 ** task.attempts) * (0.8 + Math.random() * 0.4);
      await db.execute(
        sql`UPDATE object_deletion_tasks SET last_error=${error instanceof Error ? error.name : "Storage error"},available_at=NOW()+(${delay}*INTERVAL '1 second'),lease_token=NULL WHERE id=${task.id} AND lease_token=${token}`,
      );
    }
  }
  const depth = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int n FROM object_deletion_tasks WHERE attempts>=10`,
  );
  if (depth.rows[0].n)
    await raiseAlert(db, {
      type: "object_deletion_dlq",
      category: "security",
      priorityLevel: 2,
      title: "Private object erasure needs review",
      message: `${depth.rows[0].n} storage deletions exhausted retries.`,
      dedupeKey: "object-deletion:dlq",
    });
  return { removed, dead: depth.rows[0].n };
}
