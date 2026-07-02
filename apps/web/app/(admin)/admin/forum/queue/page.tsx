"use client";

/**
 * app/(admin)/admin/forum/queue/page.tsx
 *
 * Forum moderation queue — mirrors the tabbed card-queue pattern from
 * app/(admin)/admin/moderation/page.tsx, scoped to reports targeting
 * forum questions/answers. Accessible to admins and moderators.
 */

import { useState, useEffect, useCallback } from "react";

type TabKey = "pending" | "resolved" | "escalated";

interface ForumReport {
  id: string;
  reporter_username: string | null;
  reported_forum_question_id: string | null;
  reported_forum_answer_id: string | null;
  question_title: string | null;
  answer_body: string | null;
  report_type: string;
  description: string | null;
  status: string;
  ai_category: string | null;
  ai_confidence: number | null;
  created_at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

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

function ReportCard({
  report,
  onAction,
  busy,
  isAdmin,
}: {
  report: ForumReport;
  onAction: (id: string, action: string) => void;
  busy: string | null;
  isAdmin: boolean;
}) {
  const isBusy = busy === report.id;
  const targetLabel = report.reported_forum_question_id ? "question" : "answer";
  const preview = report.question_title ?? report.answer_body ?? "(content unavailable)";

  const actions: { label: string; action: string; classes: string; hidden?: boolean }[] = [
    { label: "Dismiss", action: "dismiss", classes: "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300" },
    { label: "Warn User", action: "warn", classes: "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-300" },
    { label: "Remove Content", action: "remove_content", classes: "bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900 dark:text-orange-300" },
    { label: "Suspend 24h", action: "suspend_user", classes: "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300" },
    { label: "Ban", action: "ban_user", classes: "bg-red-600 text-white hover:bg-red-700", hidden: !isAdmin },
  ];

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-neutral-700 dark:text-neutral-200">@{report.reporter_username ?? "unknown"}</span>
        <span className="text-neutral-400">reported</span>
        <span className="rounded-full bg-teal-100 px-2 py-0.5 font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">{targetLabel}</span>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
          {report.report_type.replace(/_/g, " ")}
        </span>
        <span className="ml-auto text-neutral-400">{timeAgo(report.created_at)}</span>
      </div>

      <p className="mb-2 line-clamp-2 text-sm text-neutral-700 dark:text-neutral-300">{preview}</p>
      {report.description && <p className="mb-2 text-xs text-neutral-500">Reporter note: {report.description}</p>}
      {report.ai_category && (
        <p className="mb-3 text-xs text-neutral-500">
          AI: <span className="font-medium text-neutral-800 dark:text-neutral-200">{report.ai_category}</span>
          {report.ai_confidence != null && ` (${Math.round(report.ai_confidence * 100)}%)`}
        </p>
      )}

      {report.status === "pending" && (
        <div className="flex flex-wrap gap-1.5">
          {actions.filter((a) => !a.hidden).map(({ label, action, classes }) => (
            <button
              key={action}
              disabled={isBusy}
              onClick={() => onAction(report.id, action)}
              className={`flex items-center justify-center rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${classes}`}
            >
              {isBusy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminForumQueuePage() {
  const [tab, setTab] = useState<TabKey>("pending");
  const [reports, setReports] = useState<ForumReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setIsAdmin(!!(json?.user ?? json)?.is_admin))
      .catch(() => {});
  }, []);

  const fetchReports = useCallback(async (status: TabKey) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/forum/queue?status=${status}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) { window.location.href = "/admin/login"; return; }
      if (!res.ok) throw new Error("Failed to load reports");
      const data = (await res.json()) as { data?: { items?: ForumReport[] } };
      setReports(data.data?.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchReports(tab); }, [tab, fetchReports]);

  async function handleAction(reportId: string, action: string) {
    setBusy(reportId);
    try {
      const res = await fetch(`/api/admin/forum/queue/${reportId}/action`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action === "suspend_user" ? { duration_hours: 24 } : {}) }),
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
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Forum Moderation Queue</h1>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-6 flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${tab === key ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-900 dark:text-neutral-50" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

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
          reports.map((r) => <ReportCard key={r.id} report={r} onAction={handleAction} busy={busy} isAdmin={isAdmin} />)
        )}
      </div>
    </div>
  );
}
