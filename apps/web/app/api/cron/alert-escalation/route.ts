export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * app/api/cron/alert-escalation/route.ts
 *
 * Externally-triggered CRON (cron-jobs.org or similar — Vercel Hobby only
 * allows daily crons, this needs to run every 15-30 minutes):
 *   URL: /api/cron/alert-escalation
 *   Header: Authorization: Bearer <CRON_SECRET>
 *
 * Responsibilities (idempotent — safe to call multiple times):
 *  1. Re-notify every unresolved Level 1/2 alert whose next_escalation_at is
 *     due, advancing its backoff -> daily -> weekly escalation state first
 *     (see lib/alerts/schedule.ts) so an overlapping run never double-sends.
 *  2. Check sitewide report velocity (distinct reports across all targets in
 *     the last hour) for brigading/attack-style spikes and raise a Level 2
 *     alert if the configured threshold is crossed (folded into one open
 *     alert via dedupeKey so it doesn't spam a new alert every tick).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateCronSecret } from "@/lib/cron/auth";
import { loadManifest } from "@/lib/manifest";
import { logger } from "@/lib/logger";
import { notifyForAlert, getEscalationPolicy, raiseAlert } from "@/lib/alerts/dispatch";
import { computeNextSchedule } from "@/lib/alerts/schedule";
import type { AlertPriorityLevel } from "@/lib/alerts/types";

const BATCH_LIMIT = 50;

interface DueAlertRow {
  id: string;
  priority_level: AlertPriorityLevel;
  title: string;
  message: string;
  notify_admin: boolean;
  notify_mods: boolean;
  escalation_stage: number;
  escalation_cycle: number;
  escalation_phase: "backoff" | "daily" | "weekly" | "stopped";
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  let escalated = 0;
  const errors: string[] = [];

  // -------------------------------------------------------------------------
  // Step 1: Re-notify due Level 1/2 alerts
  // -------------------------------------------------------------------------
  try {
    const manifest = await loadManifest();
    const { rows: dueAlerts } = await db.query<DueAlertRow>(
      `SELECT id, priority_level, title, message, notify_admin, notify_mods,
              escalation_stage, escalation_cycle, escalation_phase
       FROM system_alerts
       WHERE resolved = false AND escalation_complete = false AND next_escalation_at <= $1
       ORDER BY next_escalation_at ASC
       LIMIT $2`,
      [now.toISOString(), BATCH_LIMIT]
    );

    for (const alert of dueAlerts) {
      try {
        const policy = getEscalationPolicy(manifest, alert.priority_level);
        const { nextAt, state } = computeNextSchedule(
          policy,
          { stage: alert.escalation_stage, cycle: alert.escalation_cycle, phase: alert.escalation_phase },
          now
        );

        // Advance state BEFORE sending so an overlapping run can't double-fire.
        await db.query(
          `UPDATE system_alerts
           SET escalation_stage = $2, escalation_cycle = $3, escalation_phase = $4,
               next_escalation_at = $5, escalation_complete = $6
           WHERE id = $1 AND next_escalation_at <= $7`,
          [alert.id, state.stage, state.cycle, state.phase, nextAt, nextAt === null, now.toISOString()]
        );

        await notifyForAlert(alert.id, alert.priority_level, alert.title, alert.message, alert.notify_admin, alert.notify_mods, state.stage);
        escalated++;
      } catch (err) {
        errors.push(`alert:${alert.id}: ${String(err)}`);
      }
    }
  } catch (err) {
    errors.push(`dueAlertsQuery: ${String(err)}`);
  }

  // -------------------------------------------------------------------------
  // Step 2: Sitewide report velocity check (brigading/attack detection)
  // -------------------------------------------------------------------------
  try {
    const manifest = await loadManifest();
    const threshold = manifest.alerting.reportSpike.level2VelocityThreshold;
    if (threshold > 0) {
      const { rows } = await db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM moderation_report_reporters
         WHERE created_at > NOW() - INTERVAL '1 hour'`
      );
      const reportsLastHour = parseInt(rows[0]?.count ?? "0", 10);
      if (reportsLastHour >= threshold) {
        await raiseAlert(db, {
          type: "report_velocity_spike",
          category: "moderation",
          priorityLevel: 2,
          title: "Sitewide report velocity spike",
          message: `${reportsLastHour} reports filed across the platform in the last hour (threshold: ${threshold}). Possible brigading or coordinated attack — review the Moderation Center.`,
          metadata: { reportsLastHour, threshold },
          dedupeKey: "platform_report_velocity",
        });
      }
    }
  } catch (err) {
    errors.push(`reportVelocityCheck: ${String(err)}`);
    logger.error({ err }, "[cron/alert-escalation] report velocity check failed");
  }

  return NextResponse.json({
    ok: errors.length === 0,
    escalated,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: now.toISOString(),
  });
}
