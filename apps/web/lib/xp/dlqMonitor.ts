/**
 * lib/xp/dlqMonitor.ts
 *
 * DLQ depth monitor — checks unprocessed XP award failures and alerts
 * when the backlog exceeds the configured threshold.
 */
import type { DatabaseAdapter } from "@/lib/db";

const DLQ_ALERT_THRESHOLD = 100;

export async function checkDlqDepth(
  db: DatabaseAdapter
): Promise<{ depth: number; alerted: boolean }> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM failed_xp_awards WHERE resolved_at IS NULL`,
    []
  );
  const depth = parseInt(rows[0]?.count ?? "0", 10);

  if (depth >= DLQ_ALERT_THRESHOLD) {
    await db
      .query(
        `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
         VALUES ('dlq_depth_exceeded', 'critical', $1, $2::jsonb, NOW())`,
        [
          `XP dead-letter queue depth ${depth} exceeds threshold ${DLQ_ALERT_THRESHOLD}`,
          JSON.stringify({ depth, threshold: DLQ_ALERT_THRESHOLD }),
        ]
      )
      .catch(() => {});

    console.error(
      `[dlqMonitor] DLQ depth ${depth} exceeds threshold ${DLQ_ALERT_THRESHOLD}`
    );
    return { depth, alerted: true };
  }

  return { depth, alerted: false };
}
