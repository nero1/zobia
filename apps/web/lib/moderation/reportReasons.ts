/**
 * lib/moderation/reportReasons.ts
 *
 * Single source of truth for the report-reason options shown to a reporting
 * user, across every "Report" surface (BBForum posts, Answers, profile/user
 * reports, etc). Order matters here — it's the order buttons/options render
 * in, and product wants Scam/Fraud first (most urgent to triage) followed by
 * Spam, then everything else. "Harassment" is intentionally excluded as a
 * user-facing option (still a valid `moderation_reports.report_type` value
 * for internal/AI classification, just not offered as a reason to pick).
 *
 * `type` must match a value the report_type enum in `moderation_reports`
 * accepts (see lib/moderation/aiClassifier.ts's ReportType).
 */

import type { ReportType } from "@/lib/moderation/aiClassifier";

export interface ReportReasonOption {
  /** Stable key sent as the free-text `reason` on /api/users/[userId]/report. */
  label: string;
  /** Structured moderation_reports.report_type value. */
  type: ReportType;
}

export const REPORT_REASONS: ReportReasonOption[] = [
  { label: "Scam/Fraud", type: "scam" },
  { label: "Spam", type: "spam" },
  { label: "Fake Account", type: "other" },
  { label: "Inappropriate Content", type: "sexual_content" },
  { label: "Hate Speech", type: "hate_speech" },
  { label: "Violence", type: "violence" },
  { label: "Misinformation", type: "misinformation" },
  { label: "Self Harm", type: "self_harm" },
  { label: "Other", type: "other" },
];

/** Map a reason label (as sent to /api/users/[userId]/report) to its report_type. */
export const REASON_LABEL_TO_TYPE: Record<string, ReportType> = Object.fromEntries(
  REPORT_REASONS.map((r) => [r.label, r.type])
);
