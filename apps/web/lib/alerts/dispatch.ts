/**
 * lib/alerts/dispatch.ts
 *
 * Central entry point for the 6-level admin/mod alert system. Every part of
 * the codebase that needs to page an admin/mod should call raiseAlert()
 * instead of inserting into system_alerts directly — this is what wires up
 * priority-based channel routing (SMS/email/Telegram/push/in-app),
 * admin-vs-moderator audience rules, and Level 1/2 escalation scheduling.
 *
 * Design notes:
 *  - Financial-category alerts are ALWAYS admin-only, never moderators.
 *  - Only Level 1 and Level 2 ever send SMS (see lib/alerts/types.ts).
 *  - dedupeKey folds repeat triggers of the "same" underlying condition (e.g.
 *    a report-spike cluster, a specific CRON job) into one open alert row
 *    instead of spamming a new row (and a new page) every time — but a
 *    genuine severity UPGRADE on an existing open alert (e.g. a report
 *    cluster crossing from Level 4 into Level 2) still re-notifies at the
 *    new, higher priority.
 *  - All channel sends are best-effort and logged to alert_notification_log;
 *    a failure on one channel never blocks the others.
 */

import { db } from "@/lib/db";
import type { DatabaseAdapter, TransactionClient } from "@/lib/db/interface";
import { loadManifest } from "@/lib/manifest";
import { logger } from "@/lib/logger";
import { insertNotificationBatch } from "@/lib/notifications/insert";
import { sendEmail } from "@/lib/notifications/email";
import { sendTelegramMessage } from "@/lib/notifications/telegram";
import { sendPushNotification } from "@/lib/notifications/push";
import { sendSms } from "@/lib/notifications/sms";
import { resolveAlertRecipients, type AlertRecipient } from "@/lib/alerts/recipients";
import { ALERT_PRIORITY_LEVELS, isFinancialCategory, type AlertCategory, type AlertChannel, type AlertPriorityLevel } from "@/lib/alerts/types";
import { computeInitialSchedule, type EscalationPolicy } from "@/lib/alerts/schedule";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RaiseAlertInput {
  /** Machine-readable alert type key, e.g. "low_payout_balance", "site_down". */
  type: string;
  category: AlertCategory;
  priorityLevel: AlertPriorityLevel;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  /**
   * Folds repeat triggers of the same underlying condition into one open
   * alert row instead of creating a new one each time (e.g. a report
   * cluster's key, or a CRON job's name). Omit for one-off events.
   */
  dedupeKey?: string;
  /** Rare override — forces moderator notification on/off regardless of category default. */
  notifyModsOverride?: boolean;
}

export interface RaiseAlertResult {
  alertId: string;
  isNew: boolean;
  /** True if an existing open alert was upgraded to a higher priority (and re-notified). */
  isUpgrade: boolean;
}

interface SystemAlertRow {
  id: string;
  type: string;
  category: string;
  priority_level: number;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  notify_admin: boolean;
  notify_mods: boolean;
}

// ---------------------------------------------------------------------------
// Audience resolution
// ---------------------------------------------------------------------------

async function resolveAudience(
  category: AlertCategory,
  notifyModsOverride: boolean | undefined
): Promise<{ notifyAdmin: boolean; notifyMods: boolean }> {
  if (isFinancialCategory(category)) return { notifyAdmin: true, notifyMods: false };
  if (notifyModsOverride !== undefined) return { notifyAdmin: true, notifyMods: notifyModsOverride };
  if (category === "site" || category === "security" || category === "moderation") {
    return { notifyAdmin: true, notifyMods: true };
  }
  const manifest = await loadManifest();
  return { notifyAdmin: true, notifyMods: manifest.alerting.notifyModsForInfraOther };
}

// ---------------------------------------------------------------------------
// Escalation policy lookup (shared with app/api/cron/alert-escalation)
// ---------------------------------------------------------------------------

/** Resolves the hour-schedule/cycle/daily/weekly policy for Level 1 or 2 from the manifest. */
export function getEscalationPolicy(
  manifest: Awaited<ReturnType<typeof loadManifest>>,
  priorityLevel: AlertPriorityLevel
): EscalationPolicy {
  const e = manifest.alerting.escalation;
  if (priorityLevel === 1) {
    return { hoursSchedule: e.level1HoursSchedule, cycles: e.level1Cycles, dailyPhaseDays: e.level1DailyPhaseDays, weeklyPhaseWeeks: e.level1WeeklyPhaseWeeks };
  }
  return { hoursSchedule: e.level2HoursSchedule, cycles: e.level2Cycles, dailyPhaseDays: e.level2DailyPhaseDays, weeklyPhaseWeeks: e.level2WeeklyPhaseWeeks };
}

// ---------------------------------------------------------------------------
// raiseAlert
// ---------------------------------------------------------------------------

export async function raiseAlert(dbOrTx: DatabaseAdapter | TransactionClient, input: RaiseAlertInput): Promise<RaiseAlertResult> {
  const { notifyAdmin, notifyMods } = await resolveAudience(input.category, input.notifyModsOverride);
  const legacySeverity = input.priorityLevel <= 2 ? "critical" : input.priorityLevel <= 4 ? "warning" : "info";
  const metadataJson = JSON.stringify(input.metadata ?? {});

  let alertId = "";
  let isNew = false;
  let isUpgrade = false;

  if (input.dedupeKey) {
    // Two concurrent raiseAlert() calls for the same (type, dedupe_key) can both
    // pass the "not found" check and race on INSERT. Using ON CONFLICT DO NOTHING
    // (rather than catching the unique_violation) is required here because this
    // can run inside an open transaction (e.g. lib/moderation/clustering.ts) —
    // an unhandled error would abort the whole transaction until rollback, so a
    // thrown-and-caught 23505 is NOT recoverable mid-transaction. ON CONFLICT
    // DO NOTHING never raises: it just returns zero rows, letting us fall
    // through to the SELECT-and-upgrade-or-merge path against whichever
    // concurrent call won the race.
    let existing: SystemAlertRow | undefined;
    const { rows: insertedRows } = await dbOrTx.query<{ id: string }>(
      `INSERT INTO system_alerts
         (type, category, severity, priority_level, title, message, metadata,
          notify_admin, notify_mods, dedupe_key, resolved, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, false, NOW(), NOW())
       ON CONFLICT (type, dedupe_key) WHERE resolved = false AND dedupe_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [input.type, input.category, legacySeverity, input.priorityLevel, input.title, input.message, metadataJson, notifyAdmin, notifyMods, input.dedupeKey]
    );

    if (insertedRows.length > 0) {
      alertId = insertedRows[0].id;
      isNew = true;
    } else {
      // Lost the race (or an open alert already existed before this call) — look it up.
      const { rows: existingRows } = await dbOrTx.query<SystemAlertRow>(
        `SELECT id, type, category, priority_level, title, message, metadata, notify_admin, notify_mods
         FROM system_alerts WHERE type = $1 AND dedupe_key = $2 AND resolved = false LIMIT 1`,
        [input.type, input.dedupeKey]
      );
      existing = existingRows[0];
    }

    if (!isNew && existing) {
      if (input.priorityLevel < existing.priority_level) {
        // Severity upgrade — bump the alert and re-notify at the new level.
        await dbOrTx.query(
          `UPDATE system_alerts
           SET priority_level = $2, category = $3, severity = $4, title = $5, message = $6,
               metadata = metadata || $7::jsonb, notify_admin = $8, notify_mods = $9,
               escalation_stage = 0, escalation_cycle = 0, escalation_phase = 'backoff',
               escalation_complete = false, updated_at = NOW()
           WHERE id = $1`,
          [existing.id, input.priorityLevel, input.category, legacySeverity, input.title, input.message, metadataJson, notifyAdmin, notifyMods]
        );
        alertId = existing.id;
        isUpgrade = true;
      } else {
        // Same/lower severity repeat trigger — just merge metadata (e.g. bump a counter), don't re-page.
        await dbOrTx.query(`UPDATE system_alerts SET metadata = metadata || $2::jsonb, updated_at = NOW() WHERE id = $1`, [
          existing.id,
          metadataJson,
        ]);
        return { alertId: existing.id, isNew: false, isUpgrade: false };
      }
    }

    if (!alertId) {
      // Unreachable in practice (the loop above always either inserts, upgrades,
      // or returns early) — guards against silently proceeding with a blank id.
      throw new Error(`raiseAlert: failed to resolve alertId for dedupeKey ${input.dedupeKey}`);
    }
  } else {
    const { rows } = await dbOrTx.query<{ id: string }>(
      `INSERT INTO system_alerts
         (type, category, severity, priority_level, title, message, metadata,
          notify_admin, notify_mods, resolved, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, false, NOW(), NOW())
       RETURNING id`,
      [input.type, input.category, legacySeverity, input.priorityLevel, input.title, input.message, metadataJson, notifyAdmin, notifyMods]
    );
    alertId = rows[0].id;
    isNew = true;
  }

  // Schedule Level 1/2 escalation (fresh alert or an upgrade into 1/2).
  if (ALERT_PRIORITY_LEVELS[input.priorityLevel].escalates) {
    const manifest = await loadManifest();
    const policy = getEscalationPolicy(manifest, input.priorityLevel);
    const { nextAt } = computeInitialSchedule(policy);
    await dbOrTx.query(
      `UPDATE system_alerts SET next_escalation_at = $2, escalation_complete = $3 WHERE id = $1`,
      [alertId, nextAt, nextAt === null]
    );
  } else {
    await dbOrTx.query(`UPDATE system_alerts SET escalation_complete = true WHERE id = $1`, [alertId]);
  }

  if (isNew || isUpgrade) {
    // Best-effort — never let notification delivery failures affect the caller
    // (e.g. a payout code path raising a financial alert should not fail the
    // payout itself because Mailgun timed out).
    void notifyForAlert(alertId, input.priorityLevel, input.title, input.message, notifyAdmin, notifyMods, 0).catch((err) =>
      logger.error({ err, alertId }, "[alerts/dispatch] notifyForAlert failed")
    );
  }

  return { alertId, isNew, isUpgrade };
}

// ---------------------------------------------------------------------------
// Notification fan-out (also called by the escalation CRON for repeat sends)
// ---------------------------------------------------------------------------

export async function notifyForAlert(
  alertId: string,
  priorityLevel: AlertPriorityLevel,
  title: string,
  message: string,
  notifyAdmin: boolean,
  notifyMods: boolean,
  escalationStage: number
): Promise<void> {
  const manifest = await loadManifest();
  const channelConfig = manifest.alerting.channels[priorityLevel];
  const enabledChannels: AlertChannel[] = (["sms", "email", "telegram", "push", "in_app"] as AlertChannel[]).filter((c) => {
    if (c === "sms") return channelConfig.sms && ALERT_PRIORITY_LEVELS[priorityLevel].defaultChannels.includes("sms");
    if (c === "email") return channelConfig.email;
    if (c === "telegram") return channelConfig.telegram;
    if (c === "push") return channelConfig.push;
    return channelConfig.inApp;
  });

  if (enabledChannels.length === 0) return;

  const recipients = await resolveAlertRecipients(db, notifyAdmin, notifyMods);
  if (recipients.length === 0) {
    logger.warn({ alertId }, "[alerts/dispatch] No admin/moderator recipients found — alert not delivered anywhere");
    return;
  }

  const levelLabel = ALERT_PRIORITY_LEVELS[priorityLevel].label;
  const smsText = `[Zobia ${levelLabel}] ${title}: ${message}`.slice(0, 640);
  const telegramText = `<b>🚨 [${levelLabel}] ${escapeHtml(title)}</b>\n${escapeHtml(message)}`;

  interface LogRow {
    channel: AlertChannel;
    recipientType: "admin" | "moderator";
    recipientUserId: string | null;
    status: "sent" | "failed" | "skipped";
    error: string | null;
  }
  const logRows: LogRow[] = [];

  const jobs: Promise<void>[] = [];

  if (enabledChannels.includes("in_app")) {
    jobs.push(
      insertNotificationBatch(
        db,
        recipients.map((r) => r.userId),
        "admin_alert",
        `[${levelLabel}] ${title}`,
        message,
        { alertId, priorityLevel }
      )
        .then(() => recipients.forEach((r) => logRows.push({ channel: "in_app", recipientType: r.type, recipientUserId: r.userId, status: "sent", error: null })))
        .catch((err) => {
          recipients.forEach((r) => logRows.push({ channel: "in_app", recipientType: r.type, recipientUserId: r.userId, status: "failed", error: String(err) }));
        })
    );
  }

  if (enabledChannels.includes("email")) {
    for (const r of recipients) {
      if (!r.email) continue;
      jobs.push(
        sendEmail(r.email, `[${levelLabel}] ${title}`, message)
          .then(() => { logRows.push({ channel: "email", recipientType: r.type, recipientUserId: r.userId, status: "sent", error: null }); })
          .catch((err) => { logRows.push({ channel: "email", recipientType: r.type, recipientUserId: r.userId, status: "failed", error: String(err) }); })
      );
    }
  }

  if (enabledChannels.includes("telegram")) {
    for (const r of recipients) {
      if (!r.telegramId) continue;
      sendTelegramMessage(r.telegramId, telegramText); // fire-and-forget by design
      logRows.push({ channel: "telegram", recipientType: r.type, recipientUserId: r.userId, status: "sent", error: null });
    }
  }

  if (enabledChannels.includes("push")) {
    for (const r of recipients) {
      jobs.push(
        sendPushNotification(r.userId, `[${levelLabel}] ${title}`, message, { priority: "high", data: { alertId, priorityLevel } })
          .then(() => { logRows.push({ channel: "push", recipientType: r.type, recipientUserId: r.userId, status: "sent", error: null }); })
          .catch((err) => { logRows.push({ channel: "push", recipientType: r.type, recipientUserId: r.userId, status: "failed", error: String(err) }); })
      );
    }
  }

  let smsSentCount = 0;
  if (enabledChannels.includes("sms")) {
    const smsRecipients = recipients.filter((r): r is AlertRecipient & { phoneNumber: string } => !!r.phoneNumber && r.smsEnabled);
    for (const r of smsRecipients) {
      jobs.push(
        sendSms(r.phoneNumber, smsText, manifest.alerting.smsProvider).then((result) => {
          logRows.push({ channel: "sms", recipientType: r.type, recipientUserId: r.userId, status: result.ok ? "sent" : "failed", error: result.ok ? null : result.error ?? "unknown" });
          if (result.ok) smsSentCount++;
        })
      );
    }
  }

  await Promise.allSettled(jobs);

  await db
    .query(
      `UPDATE system_alerts
       SET first_notified_at = COALESCE(first_notified_at, NOW()),
           last_notified_at = NOW(),
           sms_sent_count = sms_sent_count + $2,
           channels_sent = (SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements_text(channels_sent || $3::jsonb) v)
       WHERE id = $1`,
      [alertId, smsSentCount, JSON.stringify(enabledChannels)]
    )
    .catch((err) => logger.error({ err, alertId }, "[alerts/dispatch] failed to update alert delivery state"));

  if (logRows.length > 0) {
    await insertAlertNotificationLog(alertId, escalationStage, logRows).catch((err) =>
      logger.error({ err, alertId }, "[alerts/dispatch] failed to write alert_notification_log")
    );
  }
}

interface AlertNotificationLogRow {
  channel: AlertChannel;
  recipientType: "admin" | "moderator";
  recipientUserId: string | null;
  status: "sent" | "failed" | "skipped";
  error: string | null;
}

async function insertAlertNotificationLog(alertId: string, escalationStage: number, rows: AlertNotificationLogRow[]): Promise<void> {
  const params: (string | number | null)[] = [];
  const clauses = rows.map((row, i) => {
    const base = i * 7;
    params.push(alertId, escalationStage, row.channel, row.recipientType, row.recipientUserId, row.status, row.error);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
  });
  await db.query(
    `INSERT INTO alert_notification_log (alert_id, escalation_stage, channel, recipient_type, recipient_user_id, status, error) VALUES ${clauses.join(", ")}`,
    params
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
