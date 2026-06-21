/**
 * lib/xp/dlqMonitor.ts
 *
 * DLQ depth monitor — checks unprocessed XP award failures and alerts
 * when the backlog exceeds the configured threshold.
 */
import type { DatabaseAdapter } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getManifestValue } from "@/lib/manifest";

export async function checkDlqDepth(
  db: DatabaseAdapter
): Promise<{ depth: number; alerted: boolean }> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM failed_xp_awards WHERE resolved_at IS NULL`,
    []
  );
  const depth = parseInt(rows[0]?.count ?? "0", 10);

  // TASK-23: read threshold from manifest so ops can tune without redeployment
  const thresholdRaw = await getManifestValue("dlq_alert_threshold").catch(() => null);
  const threshold = thresholdRaw ? parseInt(thresholdRaw, 10) || 100 : 100;

  if (depth >= threshold) {
    await db
      .query(
        `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
         VALUES ('dlq_depth_exceeded', 'critical', $1, $2::jsonb, NOW())`,
        [
          `XP dead-letter queue depth ${depth} exceeds threshold ${threshold}`,
          JSON.stringify({ depth, threshold }),
        ]
      )
      .catch(() => {});

    logger.error({ depth, threshold }, `[dlqMonitor] DLQ depth ${depth} exceeds threshold ${threshold}`);
    return { depth, alerted: true };
  }

  return { depth, alerted: false };
}
