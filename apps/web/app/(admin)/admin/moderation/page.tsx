"use client";

/**
 * app/(admin)/admin/moderation/page.tsx
 *
 * Moderation queue for admin panel.
 * Lists pending reports ordered by AI confidence (descending).
 * One-click actions: Dismiss, Warn, Remove Content, Suspend, Ban.
 * Resolved / Escalated tabs show historical records.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReportTarget = "user" | "message" | "room" | "guild";
type ReportStatus = "pending" | "resolved" | "escalated";

interface Report {
  id: string;
  reporterUsername: string;
  targetType: ReportTarget;
  targetId: string;
  reportType: string;
  aiCategory: string;
  aiConfidence: number; // 0–100
  createdAt: string;
  status: ReportStatus;
  resolvedBy?: string;
  resolvedAt?: string;
  actionTaken?: string;
}

type TabKey = "pending" | "resolved" | "escalated";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TARGET_BADGE: Record<ReportTarget, string> = {
  user: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  message: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  room: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  guild: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

const REPORT_TYPE_BADGE: Record<string, string> = {
  spam: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  harassment: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  hate_speech: "bg-red-200 text-red-800 dark:bg-red-950 dark:text-red-200",
  misinformation: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  sexual_content: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  violence: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  scam: "bg-amber-200 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  other: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex gap-2">
        <div className="h-5 w-20 rounded-full bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-5 w-24 rounded-full bg-neutral-200 dark:bg-neutral-700" />
      </div>
      <div className="mb-2 h-4 w-2/3 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI confidence bar
// ---------------------------------------------------------------------------

function ConfidenceBar({ value }: { value: number }) {
  const color =
    value >= 80 ? "bg-red-500" : value >= 50 ? "bg-amber-500" : "bg-teal-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="w-8 text-right text-xs tabular-nums text-neutral-500">{value}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report card
// ---------------------------------------------------------------------------

interface ReportCardProps {
  report: Report;
  onAction: (reportId: string, action: string) => Promise<void>;
  busy: string | null;
}

function ReportCard({ report, onAction, busy }: ReportCardProps) {
  const isBusy = busy === report.id;

  const actions: { label: string; action: string; classes: string }[] = [
    { label: "Dismiss", action: "dismiss", classes: "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300" },
    { label: "Warn User", action: "warn", classes: "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-300" },
    { label: "Remove Content", action: "remove_content", classes: "bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900 dark:text-orange-300" },
    { label: "Suspend 24h", action: "suspend_24h", classes: "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300" },
    { label: "Suspend 7d", action: "suspend_7d", classes: "bg-red-200 text-red-800 hover:bg-red-300 dark:bg-red-950 dark:text-red-200" },
    { label: "Ban", action: "ban", classes: "bg-red-600 text-white hover:bg-red-700" },
  ];

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      {/* Header row */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-neutral-700 dark:text-neutral-200">
          @{report.reporterUsername}
        </span>
        <span className="text-neutral-400">reported</span>
        <span className={`rounded-full px-2 py-0.5 font-semibold ${TARGET_BADGE[report.targetType]}`}>
          {report.targetType}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 font-semibold ${
            REPORT_TYPE_BADGE[report.reportType] ?? REPORT_TYPE_BADGE.other
          }`}
        >
          {report.reportType.replace(/_/g, " ")}
        </span>
        <span className="ml-auto text-neutral-400">{timeAgo(report.createdAt)}</span>
      </div>

      {/* AI analysis */}
      <div className="mb-3 space-y-1">
        <p className="text-xs text-neutral-500">
          AI: <span className="font-medium text-neutral-800 dark:text-neutral-200">{report.aiCategory}</span>
        </p>
        <ConfidenceBar value={report.aiConfidence} />
      </div>

      {/* Target ID */}
      <p className="mb-3 truncate text-xs text-neutral-400">Target ID: {report.targetId}</p>

      {/* Actions */}
      {report.status === "pending" && (
        <div className="flex flex-wrap gap-1.5">
          {actions.map(({ label, action, classes }) => (
            <button
              key={action}
              disabled={isBusy}
              onClick={() => onAction(report.id, action)}
              className={`flex items-center justify-center rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${classes}`}
            >
              {isBusy ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                label
              )}
            </button>
          ))}
        </div>
      )}

      {/* Resolved info */}
      {report.status !== "pending" && (
        <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-2 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/50">
          <span className="font-medium capitalize">{report.status}</span>
          {report.actionTaken && <> · {report.actionTaken.replace(/_/g, " ")}</>}
          {report.resolvedBy && <> · by @{report.resolvedBy}</>}
          {report.resolvedAt && <> · {formatDate(report.resolvedAt)}</>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Admin moderation queue page.
 * Requires admin authentication (enforced by middleware).
 */
export default function AdminModerationPage() {
  const [tab, setTab] = useState<TabKey>("pending");
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchReports = useCallback(async (status: TabKey) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/moderation?status=${status}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/admin/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load reports");
      const data = (await res.json()) as { reports: Report[] };
      setReports(data.reports);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchReports(tab);
  }, [tab, fetchReports]);

  async function handleAction(reportId: string, action: string) {
    setBusy(reportId);
    try {
      const res = await fetch(`/api/admin/moderation/${reportId}/action`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("Action failed");
      showToast("Action applied");
      await fetchReports(tab);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Action failed", "error");
    } finally {
      setBusy(null);
    }
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "resolved", label: "Resolved" },
    { key: "escalated", label: "Escalated" },
  ];

  return (
    <div className="relative">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Moderation Queue</h1>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${
            toast.type === "success" ? "bg-teal-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
              tab === key
                ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-900 dark:text-neutral-50"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} />)
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white py-20 dark:border-neutral-800 dark:bg-neutral-900">
            <span className="text-4xl">✓</span>
            <p className="mt-3 text-lg font-semibold text-neutral-700 dark:text-neutral-300">Queue is clear ✓</p>
            <p className="mt-1 text-sm text-neutral-500">No {tab} reports at this time.</p>
          </div>
        ) : (
          reports.map((r) => (
            <ReportCard key={r.id} report={r} onAction={handleAction} busy={busy} />
          ))
        )}
      </div>
    </div>
  );
}
