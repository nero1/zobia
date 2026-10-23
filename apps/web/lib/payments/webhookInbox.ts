import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/drizzle";
import { handlePaystackWebhookPayload } from "./paystackWebhookHandler";
import { createHash, randomUUID } from "node:crypto";
import { raiseAlert } from "@/lib/alerts/dispatch";

/** A verified provider event is durable before HTTP acknowledgment. */
export async function receivePaystackEvent(
  event: { event: string },
  raw: string,
): Promise<string> {
  const db = await getDb();
  const key = createHash("sha256").update(raw).digest("hex");
  const result = await db.execute<{ id: string }>(
    sql`INSERT INTO failed_webhooks(provider,event_type,payload,event_key) VALUES ('paystack',${event.event},${raw}::jsonb,${key}) ON CONFLICT(event_key) DO UPDATE SET event_key=EXCLUDED.event_key RETURNING id`,
  );
  return result.rows[0].id;
}
export async function processInboxEvent(id: string): Promise<boolean> {
  const db = await getDb();
  const lease = randomUUID();
  const claim = await db.execute<{
    id: string;
    event_type: string;
    payload: unknown;
    retry_count: number;
    max_attempts: number;
  }>(
    sql`UPDATE failed_webhooks SET processing_token=${lease},retry_count=retry_count+1,next_retry_at=NOW()+INTERVAL '5 minutes' WHERE id=${id} AND resolved_at IS NULL AND retry_count < max_attempts AND (next_retry_at IS NULL OR next_retry_at <= NOW()) RETURNING id,event_type,payload,retry_count,max_attempts`,
  );
  const row = claim.rows[0];
  if (!row) return false;
  try {
    await handlePaystackWebhookPayload(row.event_type, row.payload);
    await db.execute(
      sql`UPDATE failed_webhooks SET resolved=true,resolved_at=NOW(),updated_at=NOW(),last_error=NULL,processing_token=NULL WHERE id=${id} AND processing_token=${lease}`,
    );
    return true;
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message.slice(0, 500)
        : "Webhook processing failed";
    const delay = Math.min(
      3600,
      Math.round(30 * 2 ** (row.retry_count - 1) * (0.8 + Math.random() * 0.4)),
    );
    await db.execute(
      sql`UPDATE failed_webhooks SET processing_token=NULL,last_error=${reason},error=${reason},next_retry_at=NOW()+(${delay} * INTERVAL '1 second'),updated_at=NOW() WHERE id=${id} AND processing_token=${lease}`,
    );
    if (row.retry_count >= row.max_attempts)
      await raiseAlert(db, {
        type: "webhook_dead_letter",
        category: "financial",
        priorityLevel: 2,
        title: "Webhook needs review",
        message: "A verified event exhausted automatic retries.",
        metadata: { id },
        dedupeKey: `webhook:dead:${id}`,
      });
    throw error;
  }
}
export async function retryWebhookInbox(): Promise<{
  attempted: number;
  resolved: number;
  dead: number;
}> {
  const db = await getDb();
  const candidates = await db.execute<{ id: string }>(
    sql`SELECT id FROM failed_webhooks WHERE provider='paystack' AND resolved_at IS NULL AND retry_count<max_attempts AND (next_retry_at IS NULL OR next_retry_at <= NOW()) ORDER BY created_at,id LIMIT 50`,
  );
  let resolved = 0;
  for (const row of candidates.rows) {
    try {
      if (await processInboxEvent(row.id)) resolved++;
    } catch {
      /* durable retry/dead-letter state already recorded */
    }
  }
  const counts = await db.execute<{ n: number }>(
    sql`SELECT count(*)::int n FROM failed_webhooks WHERE resolved_at IS NULL AND retry_count>=max_attempts`,
  );
  const dead = counts.rows[0].n;
  if (dead)
    await raiseAlert(db, {
      type: "webhook_dlq_depth",
      category: "financial",
      priorityLevel: 2,
      title: "Webhook recovery backlog",
      message: `${dead} verified events require review.`,
      metadata: { dead },
      dedupeKey: "webhook:dlq:depth",
    });
  await db.execute(
    sql`DELETE FROM failed_webhooks WHERE resolved_at<NOW()-INTERVAL '30 days'`,
  );
  return { attempted: candidates.rows.length, resolved, dead };
}
