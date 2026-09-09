/**
 * lib/moderation/clustering.ts
 *
 * Report flood control (PRD "REPORTING — handling hundreds of similar or
 * identical reports on a specific content").
 *
 * Without this, a single piece of bad content reported by hundreds of users
 * would create hundreds of near-identical rows in the moderation queue. This
 * module folds every new report against the SAME target, made within a
 * rolling window (admin-configurable, default 24h), into the one existing
 * PENDING `moderation_reports` row — bumping `duplicate_count` and recording
 * the extra reporter in `moderation_report_reporters` (so each of them can
 * still be rewarded/penalized individually, see lib/moderation/rewards.ts) —
 * instead of creating a new queue entry.
 *
 * If the number of distinct reporters against a target crosses an
 * admin-configurable threshold before a moderator has reviewed it, the
 * target is automatically quarantined (soft-hidden) pending review. The
 * quarantine is logged as an `automated` moderation_actions row against the
 * cluster's report, so it shows in the existing Audit Log and can be undone
 * with the existing POST /api/admin/moderation/actions/[actionId]/reverse
 * endpoint exactly like a manual "Remove Content" action.
 */

import type { TransactionClient } from "@/lib/db/interface";
import { loadManifest } from "@/lib/manifest";
import { logger } from "@/lib/logger";

export interface ReportTargets {
  reportedUserId?: string | null;
  reportedMessageId?: string | null;
  reportedRoomId?: string | null;
  reportedGuildId?: string | null;
  reportedGuildMessageId?: string | null;
  reportedForumQuestionId?: string | null;
  reportedForumAnswerId?: string | null;
  reportedBbThreadId?: string | null;
  reportedBbPostId?: string | null;
}

/**
 * Deterministic key identifying "the same reported thing" across separate
 * report submissions. Priority favours the most specific target (a single
 * message) over broader ones (the room/guild it lives in) so two people
 * reporting the SAME message cluster together, while someone reporting the
 * room in general does not silently merge into a message-specific report.
 */
export function computeClusterKey(t: ReportTargets): string | null {
  if (t.reportedMessageId) return `message:${t.reportedMessageId}`;
  if (t.reportedGuildMessageId) return `guild_message:${t.reportedGuildMessageId}`;
  if (t.reportedBbPostId) return `bb_post:${t.reportedBbPostId}`;
  if (t.reportedBbThreadId) return `bb_thread:${t.reportedBbThreadId}`;
  if (t.reportedForumAnswerId) return `forum_answer:${t.reportedForumAnswerId}`;
  if (t.reportedForumQuestionId) return `forum_question:${t.reportedForumQuestionId}`;
  if (t.reportedRoomId) return `room:${t.reportedRoomId}`;
  if (t.reportedGuildId) return `guild:${t.reportedGuildId}`;
  if (t.reportedUserId) return `user:${t.reportedUserId}`;
  return null;
}

export interface JoinClusterResult {
  /** The moderation_reports.id the reporter's submission ended up under (new or existing). */
  reportId: string;
  /** True if a brand-new moderation_reports row was created (caller should run AI classification). */
  isNew: boolean;
  /** Distinct reporter count against this target so far (including this submission). */
  duplicateCount: number;
}

/**
 * Finds an existing PENDING report for the same cluster key created within
 * the configured window; if found, records this reporter against it and
 * bumps duplicate_count (no-ops if this reporter already reported it).
 * Returns null when no existing cluster is found — the caller should insert
 * a fresh moderation_reports row and then call `registerFirstReporter`.
 */
export async function findExistingCluster(
  tx: TransactionClient,
  clusterKey: string,
  reporterId: string
): Promise<JoinClusterResult | null> {
  const manifest = await loadManifest();
  const windowHours = manifest.moderation.duplicateClusterWindowHours;

  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM moderation_reports
     WHERE cluster_key = $1
       AND status = 'pending'
       AND created_at > NOW() - ($2 || ' hours')::interval
     ORDER BY created_at DESC
     LIMIT 1`,
    [clusterKey, String(windowHours)]
  );
  const existing = rows[0];
  if (!existing) return null;

  await tx.query(
    `INSERT INTO moderation_report_reporters (report_id, reporter_id, is_first)
     VALUES ($1, $2, false)
     ON CONFLICT (report_id, reporter_id) DO NOTHING`,
    [existing.id, reporterId]
  );

  const { rows: countRows } = await tx.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM moderation_report_reporters WHERE report_id = $1`,
    [existing.id]
  );
  const duplicateCount = parseInt(countRows[0]?.count ?? "1", 10);

  await tx.query(
    `UPDATE moderation_reports SET duplicate_count = $2, updated_at = NOW() WHERE id = $1`,
    [existing.id, duplicateCount]
  );

  return { reportId: existing.id, isNew: false, duplicateCount };
}

/** Registers the first reporter of a freshly-inserted moderation_reports row. */
export async function registerFirstReporter(tx: TransactionClient, reportId: string, reporterId: string): Promise<void> {
  await tx.query(
    `INSERT INTO moderation_report_reporters (report_id, reporter_id, is_first)
     VALUES ($1, $2, true)
     ON CONFLICT (report_id, reporter_id) DO NOTHING`,
    [reportId, reporterId]
  );
}

/**
 * Auto-quarantines the reported content once `duplicateCount` crosses the
 * admin-configured threshold, IF it hasn't already been quarantined and the
 * report is still pending. Best-effort: content types outside the ones
 * handled here (rooms, guilds, users, Answers Q&A) are not auto-hidden —
 * the cluster is still boosted to the top of the queue by its duplicate
 * count, which is enough to get eyes on it quickly without risking an
 * automated takedown of content types moderators haven't reviewed yet.
 */
export async function maybeAutoQuarantine(
  tx: TransactionClient,
  reportId: string,
  clusterKey: string,
  duplicateCount: number
): Promise<void> {
  const manifest = await loadManifest();
  const threshold = manifest.moderation.duplicateAutoQuarantineThreshold;
  if (threshold <= 0 || duplicateCount < threshold) return;

  const { rows } = await tx.query<{ auto_quarantined: boolean; status: string }>(
    `SELECT auto_quarantined, status FROM moderation_reports WHERE id = $1`,
    [reportId]
  );
  const report = rows[0];
  if (!report || report.auto_quarantined || report.status !== "pending") return;

  const [kind, id] = clusterKey.split(/:(.+)/);
  let quarantined = false;

  try {
    if (kind === "message") {
      await tx.query(`UPDATE messages SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [id]);
      quarantined = true;
    } else if (kind === "guild_message") {
      await tx.query(`UPDATE guild_messages SET is_deleted = true WHERE id = $1 AND is_deleted = false`, [id]);
      quarantined = true;
    } else if (kind === "bb_post") {
      await tx.query(`UPDATE bb_posts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [id]);
      quarantined = true;
    } else if (kind === "bb_thread") {
      await tx.query(`UPDATE bb_threads SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`, [id]);
      quarantined = true;
    }
  } catch (err) {
    logger.error({ err, reportId, clusterKey }, "[moderation/clustering] auto-quarantine content update failed");
    return;
  }

  if (!quarantined) return;

  await tx.query(
    `UPDATE moderation_reports SET auto_quarantined = true, updated_at = NOW() WHERE id = $1`,
    [reportId]
  );
  await tx.query(
    `INSERT INTO moderation_actions (target_user_id, action_type, reason, report_id, actor_type, created_at, metadata)
     SELECT reported_user_id, 'remove_content', $2, id, 'automated', NOW(), $3::jsonb
     FROM moderation_reports WHERE id = $1`,
    [
      reportId,
      `Auto-quarantined after ${duplicateCount} distinct reports (threshold: ${threshold}).`,
      JSON.stringify({ duplicateCount, threshold, clusterKey }),
    ]
  );
}
