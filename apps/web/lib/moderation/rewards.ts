/**
 * lib/moderation/rewards.ts
 *
 * Reporting rewards + malicious-report trust penalty (PRD "Reporting").
 *
 * A report can have multiple reporters — moderation_reports.reporter_id is
 * the FIRST person to report a given target; every reporter (first included)
 * has a row in moderation_report_reporters (see lib/moderation/clustering.ts
 * for how duplicates get folded in). When a report resolves:
 *
 *   - accepted (any action other than dismiss): the first reporter gets
 *     Credits + XP, every subsequent reporter gets XP only.
 *   - not accepted (dismissed, not malicious): every reporter gets a small
 *     flat XP amount.
 *   - malicious/spammy (dismissed AND flagged malicious): the ORIGINAL
 *     (first) reporter's Trust Score is docked; no reward is paid. Reporters
 *     who merely piled onto an existing report are treated as ordinary
 *     "not accepted" reporters — they did not originate the bad-faith claim.
 *
 * All amounts are admin-configurable via loadManifest().moderation.
 * Idempotent: moderation_reports.reward_applied guards against double-payout
 * if an action is retried or a report is reversed and re-resolved.
 */

import { and, eq, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { loadManifest } from "@/lib/manifest";
import { creditCoins } from "@/lib/economy/coins";
import { safeAwardXPFireAndForget } from "@/lib/xp/safeAwardXP";
import { logger } from "@/lib/logger";

export type ReportOutcome = "accepted" | "not_accepted";

/**
 * Pays out reporting rewards for a resolved (non-malicious) report.
 * Safe to call at most once per report — checks/sets reward_applied first.
 */
export async function applyReportRewards(reportId: string, outcome: ReportOutcome): Promise<void> {
  try {
    const orm = await getDb();
    const guardRows = await orm
      .update(schema.moderationReports)
      .set({ rewardApplied: true })
      .where(and(eq(schema.moderationReports.id, reportId), eq(schema.moderationReports.rewardApplied, false)))
      .returning({ rewardApplied: schema.moderationReports.rewardApplied });
    if (guardRows.length === 0) return; // already paid out (or report missing)

    const reporters = await orm
      .select({ reporterId: schema.moderationReportReporters.reporterId, isFirst: schema.moderationReportReporters.isFirst })
      .from(schema.moderationReportReporters)
      .where(eq(schema.moderationReportReporters.reportId, reportId));
    if (reporters.length === 0) return;

    const manifest = await loadManifest();
    const cfg = manifest.moderation;

    for (const r of reporters) {
      const referenceId = `report_reward:${reportId}:${r.reporterId}`;
      if (outcome === "accepted") {
        if (r.isFirst) {
          if (cfg.reportRewardCreditsFirstAccepted > 0) {
            await creditCoins(
              r.reporterId,
              cfg.reportRewardCreditsFirstAccepted,
              "report_reward",
              referenceId,
              "Report accepted — first to report"
            ).catch((err) => logger.error({ err, reportId, userId: r.reporterId }, "[moderation/rewards] creditCoins failed"));
          }
          if (cfg.reportRewardXpFirstAccepted > 0) {
            safeAwardXPFireAndForget(r.reporterId, cfg.reportRewardXpFirstAccepted, "social", "report_reward_first_accepted", referenceId);
          }
        } else if (cfg.reportRewardXpSubsequentAccepted > 0) {
          safeAwardXPFireAndForget(r.reporterId, cfg.reportRewardXpSubsequentAccepted, "social", "report_reward_subsequent_accepted", referenceId);
        }
      } else if (cfg.reportRewardXpNotAccepted > 0) {
        safeAwardXPFireAndForget(r.reporterId, cfg.reportRewardXpNotAccepted, "social", "report_reward_not_accepted", referenceId);
      }
    }
  } catch (err) {
    logger.error({ err, reportId, outcome }, "[moderation/rewards] applyReportRewards failed");
  }
}

/**
 * Marks a report malicious/spammy and docks the ORIGINAL reporter's Trust
 * Score by the admin-configured penalty (floor 0 — trust_score's own CHECK
 * constraint also enforces 0-100). Does not pay any reward.
 */
export async function applyMaliciousReportPenalty(reportId: string): Promise<void> {
  try {
    const orm = await getDb();
    const guardRows = await orm
      .update(schema.moderationReports)
      .set({ isMalicious: true, rewardApplied: true })
      .where(and(eq(schema.moderationReports.id, reportId), eq(schema.moderationReports.rewardApplied, false)))
      .returning({ rewardApplied: schema.moderationReports.rewardApplied });
    if (guardRows.length === 0) return;

    const [reportRow] = await orm
      .select({ reporterId: schema.moderationReports.reporterId })
      .from(schema.moderationReports)
      .where(eq(schema.moderationReports.id, reportId));
    const originalReporterId = reportRow?.reporterId;
    if (!originalReporterId) return;

    const manifest = await loadManifest();
    const penalty = manifest.moderation.reportMaliciousTrustPenalty;
    if (penalty > 0) {
      await orm
        .update(schema.users)
        .set({ trustScore: sql`GREATEST(0, COALESCE(${schema.users.trustScore}, 50) - ${penalty})`, updatedAt: new Date() })
        .where(eq(schema.users.id, originalReporterId));
    }

    // Every OTHER reporter in the cluster is treated as an ordinary
    // "not accepted" reporter (piling onto a report they had no way to know
    // was bad-faith) — small consolation XP, no trust penalty.
    const others = await orm
      .select({ reporterId: schema.moderationReportReporters.reporterId })
      .from(schema.moderationReportReporters)
      .where(and(eq(schema.moderationReportReporters.reportId, reportId), ne(schema.moderationReportReporters.reporterId, originalReporterId)));
    const xpNotAccepted = manifest.moderation.reportRewardXpNotAccepted;
    if (xpNotAccepted > 0) {
      for (const o of others) {
        safeAwardXPFireAndForget(o.reporterId, xpNotAccepted, "social", "report_reward_not_accepted", `report_reward:${reportId}:${o.reporterId}`);
      }
    }
  } catch (err) {
    logger.error({ err, reportId }, "[moderation/rewards] applyMaliciousReportPenalty failed");
  }
}
