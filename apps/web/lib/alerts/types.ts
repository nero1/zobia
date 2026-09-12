/**
 * lib/alerts/types.ts
 *
 * The 6-level admin/mod alert priority scale (PRD §20 "Alerts & Monitoring").
 *
 * Level 1 is the most severe (Red). Level 6 is the least severe (Green).
 * Only Level 1 and Level 2 ever trigger SMS — SMS is otherwise banned
 * platform-wide (PRD §16, §22) and this is the one deliberate exception,
 * reserved for the handful of events that genuinely need someone paged.
 *
 * Financial alerts (payout treasury, reconciliation, withdrawals) are
 * ADMIN-ONLY regardless of level — moderators never see money-related
 * alerts. Site/security/moderation alerts go to admins AND moderators.
 */

export type AlertPriorityLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type AlertCategory = "site" | "security" | "financial" | "moderation" | "infra" | "other";

export type AlertChannel = "sms" | "email" | "telegram" | "push" | "in_app";

export interface AlertLevelDefinition {
  level: AlertPriorityLevel;
  key: string;
  label: string;
  /** One-line description of what belongs at this level. */
  description: string;
  /** Hex color for badges/dots in the admin UI. */
  color: string;
  /** Default channels fired on first trigger (before any admin override). */
  defaultChannels: AlertChannel[];
  /** Whether this level escalates/repeats on a schedule until resolved. */
  escalates: boolean;
}

/**
 * The 6 priority levels, darkest/most urgent (1) to lightest (6).
 * Colors follow a red -> orange -> amber -> yellow -> lime -> green ramp so
 * severity reads at a glance without relying on the label text.
 */
export const ALERT_PRIORITY_LEVELS: Record<AlertPriorityLevel, AlertLevelDefinition> = {
  1: {
    level: 1,
    key: "critical",
    label: "Critical",
    description:
      "Extremely important, extremely urgent — resolve right now. Site down / unreachable, database unreachable, active confirmed security breach, payout treasury/account empty.",
    color: "#DC2626", // red-600
    defaultChannels: ["sms", "push", "email", "telegram", "in_app"],
    escalates: true,
  },
  2: {
    level: 2,
    key: "urgent_emergency",
    label: "Urgent Emergency",
    description:
      "Very important, very urgent — resolve right now. DDoS/hacking/bot attack discovered while site is still up, payout funds low, payment reconciliation inconsistencies, mass report brigading.",
    color: "#EA580C", // orange-600
    defaultChannels: ["sms", "push", "email", "telegram", "in_app"],
    escalates: true,
  },
  3: {
    level: 3,
    key: "top_priority",
    label: "Top Priority",
    description:
      "Very important, urgent — resolve now or ASAP. Elevated error rate, moderation queue backlog, repeated failed webhook, single critical CRON failure, suspicious staff activity.",
    color: "#F59E0B", // amber-500
    defaultChannels: ["push", "email", "telegram", "in_app"],
    escalates: false,
  },
  4: {
    level: 4,
    key: "high_priority",
    label: "High Priority",
    description:
      "Very important, time sensitive — resolve ASAP. Slow query spikes, degraded cache hit ratio, moderate report spike, elevated (non-critical) API errors.",
    color: "#EAB308", // yellow-500
    defaultChannels: ["push", "telegram", "in_app"],
    escalates: false,
  },
  5: {
    level: 5,
    key: "medium_priority",
    label: "Medium Priority",
    description:
      "Important, not urgent. Minor anomalies worth reviewing, informational thresholds crossed, auto-quarantine triggered.",
    color: "#84CC16", // lime-500
    defaultChannels: ["telegram", "in_app"],
    escalates: false,
  },
  6: {
    level: 6,
    key: "low_priority",
    label: "Low Priority",
    description: "Low importance, not urgent. Routine informational/housekeeping notices.",
    color: "#22C55E", // green-500
    defaultChannels: ["in_app"],
    escalates: false,
  },
};

export const ALERT_CHANNELS: AlertChannel[] = ["sms", "email", "telegram", "push", "in_app"];

export const ALERT_CATEGORIES: AlertCategory[] = ["site", "security", "financial", "moderation", "infra", "other"];

/** Financial-category alerts are always admin-only, regardless of caller intent. */
export function isFinancialCategory(category: AlertCategory): boolean {
  return category === "financial";
}
