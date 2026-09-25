/**
 * lib/audit/pruneAuditLogs.ts
 *
 * Retention for the two audit trails (admin_audit_log, audit_log). Without a
 * ceiling these grow forever — every admin write and every login/2FA/PIN
 * event appends a row. Run from the daily-platform cron (not a standalone
 * cron slot: Vercel Hobby only allows daily crons, and this project is
 * already at its cron-slot budget — see app/api/cron/daily-platform/route.ts).
 *
 * Strategy:
 *  - Keep AUDIT_RETENTION_DAYS (default 365) of history — long enough to
 *    cover a compliance/incident-review window, short enough to bound growth.
 *  - Delete in small batches (PRUNE_BATCH_SIZE rows per table per run) so a
 *    large backlog can't blow the cron's maxDuration; steady-state daily
 *    volume is deleted well within one batch, so this typically no-ops once
 *    caught up.
 *  - Batched via `id IN (SELECT ... LIMIT n)` rather than a single unbounded
 *    DELETE, which would take a long-held lock on a huge table.
 *
 * If longer retention is ever needed for compliance, archive rows to cold
 * storage (e.g. an R2 export) before deleting instead of raising the window
 * indefinitely — that keeps the hot table small while preserving history.
 */

import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { logger } from "@/lib/logger";

const AUDIT_RETENTION_DAYS = 365;
const PRUNE_BATCH_SIZE = 5_000;

async function pruneTable(table: "admin_audit_log" | "audit_log"): Promise<number> {
  const db = await getDb();
  const tbl = table === "admin_audit_log" ? schema.adminAuditLog : schema.auditLog;
  const result = await db.delete(tbl).where(
    sql`${tbl.id} IN (
       SELECT id FROM ${tbl}
       WHERE ${tbl.createdAt} < NOW() - INTERVAL '${sql.raw(String(AUDIT_RETENTION_DAYS))} days'
       LIMIT ${sql.raw(String(PRUNE_BATCH_SIZE))}
     )`
  );
  return result.rowCount ?? 0;
}

/** Prune both audit tables. Never throws — logs and returns partial results on failure. */
export async function pruneAuditLogs(): Promise<{ adminAuditDeleted: number; securityAuditDeleted: number }> {
  let adminAuditDeleted = 0;
  let securityAuditDeleted = 0;

  try {
    adminAuditDeleted = await pruneTable("admin_audit_log");
  } catch (err) {
    logger.error({ err }, "[audit] Failed to prune admin_audit_log");
  }

  try {
    securityAuditDeleted = await pruneTable("audit_log");
  } catch (err) {
    logger.error({ err }, "[audit] Failed to prune audit_log");
  }

  if (adminAuditDeleted > 0 || securityAuditDeleted > 0) {
    logger.info({ adminAuditDeleted, securityAuditDeleted }, "[audit] Pruned expired audit log rows");
  }

  return { adminAuditDeleted, securityAuditDeleted };
}
