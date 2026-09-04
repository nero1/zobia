"use client";

/**
 * app/(app)/moderation/page.tsx
 *
 * Moderation Center — a standalone area (outside /admin) reachable by both
 * moderators and admins. Unifies the existing report queues:
 *   - "Reports"     → GET /api/admin/moderation (general reports)
 *   - "Forum Queue" → GET /api/admin/forum/queue (Answers questions/answers)
 *   - "Audit Log"   → GET /api/admin/moderation/audit (admin-only)
 *
 * Both queue tabs already ran through withModeratorOrAdminAuth server-side —
 * this page only adds a client-side gate so a non-mod never sees the UI
 * flash before the API calls 403. Resolved items show which mod/admin acted
 * (moderator_username) and offer a "Reverse" button
 * (POST /api/admin/moderation/actions/[actionId]/reverse) so mistakes can be
 * undone — reversing a ban is admin-only, mirroring the forward action.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QueueKey = "reports" | "forum" | "audit";
type StatusFilter = "pending" | "resolved" | "escalated";

interface ReportItem {
  id: string;
  reporter_username: string | null;
  reported_user_username?: string | null;
  question_title?: string | null;
  answer_body?: string | null;
  report_type: string;
  description: string | null;
  status: string;
  ai_category: string | null;
  ai_confidence: number | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_by_username: string | null;
  resolution_note: string | null;
  action_id: string | null;
}

interface AuditItem {
  id: string;
  action_type: string;
  reason: string | null;
  target_user_id: string | null;
  target_username: string | null;
  moderator_username: string | null;
  created_at: string;
  reversed_at: string | null;
  reversed_by_username: string | null;
  reversal_note: string | null;
}

interface Me {
  is_admin?: boolean;
  is_moderator?: boolean;
}

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

const ACTIONS: { label: string; action: string; durationHours?: number; adminOnly?: boolean; classes: string }[] = [
  { label: "Dismiss", action: "dismiss", classes: "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300" },
  { label: "Warn", action: "warn", classes: "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-300" },
  { label: "Remove Content", action: "remove_content", classes: "bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900 dark:text-orange-300" },
  { label: "Suspend 24h", action: "suspend_user", durationHours: 24, classes: "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300" },
  { label: "Suspend 7d", action: "suspend_user", durationHours: 168, classes: "bg-red-200 text-red-800 hover:bg-red-300 dark:bg-red-950 dark:text-red-200" },
  { label: "Ban", action: "ban_user", adminOnly: true, classes: "bg-red-600 text-white hover:bg-red-700" },
];

// ---------------------------------------------------------------------------
// Report card
// ---------------------------------------------------------------------------

function ReportCard({
  item,
  queue,
  isAdmin,
  busy,
  onAction,
  onReverse,
}: {
  item: ReportItem;
  queue: "reports" | "forum";
  isAdmin: boolean;
  busy: string | null;
  onAction: (item: ReportItem, action: string, durationHours?: number) => void;
  onReverse: (item: ReportItem) => void;
}) {
  const isBusy = busy === item.id;
  const title = queue === "forum" ? item.question_title ?? item.answer_body ?? "(forum content)" : item.reported_user_username ?? "(target)";

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-neutral-700 dark:text-neutral-200">@{item.reporter_username ?? "unknown"}</span>
        <span className="text-neutral-400">reported</span>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
          {item.report_type.replace(/_/g, " ")}
        </span>
        {item.ai_confidence !== null && (
          <span className="rounded-full bg-teal-100 px-2 py-0.5 font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">
            AI {Math.round(item.ai_confidence)}%
          </span>
        )}
        <span className="ml-auto text-neutral-400">{timeAgo(item.created_at)}</span>
      </div>
      <p className="mb-3 truncate text-sm text-neutral-700 dark:text-neutral-300">{title}</p>

      {item.status === "pending" ? (
        <div className="flex flex-wrap gap-1.5">
          {ACTIONS.filter((a) => !a.adminOnly || isAdmin).map(({ label, action, durationHours, classes }) => (
            <button
              key={label}
              disabled={isBusy}
              onClick={() => onAction(item, action, durationHours)}
              className={`flex items-center justify-center rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${classes}`}
            >
              {isBusy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : label}
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-2 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/50">
          <span className="font-medium capitalize">{item.status}</span>
          {item.resolved_by_username && <> · by @{item.resolved_by_username}</>}
          {item.resolved_at && <> · {timeAgo(item.resolved_at)}</>}
          {item.resolution_note && <> — {item.resolution_note}</>}
          {item.action_id && (
            <button
              disabled={isBusy}
              onClick={() => onReverse(item)}
              className="ml-2 rounded-full bg-neutral-200 px-2 py-0.5 font-semibold text-neutral-700 hover:bg-neutral-300 disabled:opacity-50 dark:bg-neutral-700 dark:text-neutral-200"
            >
              Reverse
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ModerationCenterPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  const router = useRouter();

  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [queue, setQueue] = useState<QueueKey>("reports");
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [items, setItems] = useState<ReportItem[]>([]);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const user = json?.user ?? json;
        setMe(user);
        if (!user?.is_admin && !user?.is_moderator) {
          router.replace("/home");
        }
      })
      .catch(() => router.replace("/home"))
      .finally(() => setChecked(true));
  }, [router]);

  const isAdmin = Boolean(me?.is_admin);
  const isMod = Boolean(me?.is_admin || me?.is_moderator);

  const load = useCallback(async () => {
    if (!isMod) return;
    setLoading(true);
    setError(null);
    try {
      if (queue === "audit") {
        const res = await fetch("/api/admin/moderation/audit", { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load audit log");
        const data = (await res.json()) as { data?: { items?: AuditItem[] } };
        setAuditItems(data.data?.items ?? []);
      } else {
        const endpoint = queue === "forum" ? "/api/admin/forum/queue" : "/api/admin/moderation";
        const res = await fetch(`${endpoint}?status=${status}`, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load queue");
        const data = (await res.json()) as { items?: ReportItem[] };
        setItems(data.items ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message) : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [queue, status, isMod]);

  useEffect(() => { void load(); }, [load]);

  async function handleAction(item: ReportItem, action: string, durationHours?: number) {
    setBusy(item.id);
    try {
      const endpoint = queue === "forum" ? `/api/admin/forum/queue/${item.id}/action` : `/api/admin/moderation/${item.id}/action`;
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(durationHours ? { duration_hours: durationHours } : {}) }),
      });
      if (!res.ok) throw new Error("Action failed");
      showToast(t("moderation.actionApplied", "Action applied"));
      await load();
    } catch (e) {
      showToast(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message) : "Action failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleReverse(item: ReportItem) {
    if (!item.action_id) return;
    const note = window.prompt(t("moderation.reverseNotePrompt", "Optional note for the audit trail:")) ?? undefined;
    setBusy(item.id);
    try {
      const res = await fetch(`/api/admin/moderation/actions/${item.action_id}/reverse`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note || undefined }),
      });
      if (!res.ok) throw new Error("Reverse failed");
      showToast(t("moderation.actionReversed", "Action reversed"));
      await load();
    } catch (e) {
      showToast(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message) : "Reverse failed", "error");
    } finally {
      setBusy(null);
    }
  }

  if (!checked) {
    return <div className="mx-auto max-w-3xl p-6 text-sm text-neutral-500">{t("action.loading", "Loading…")}</div>;
  }
  if (!isMod) return null;

  const queueTabs: { key: QueueKey; label: string }[] = [
    { key: "reports", label: t("moderation.tab.reports", "Reports") },
    { key: "forum", label: t("moderation.tab.forum", "Forum Queue") },
    ...(isAdmin ? [{ key: "audit" as QueueKey, label: t("moderation.tab.audit", "Audit Log") }] : []),
  ];

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          {t("moderation.title", "Moderation Center")}
        </h1>
        {isAdmin && (
          <Link href="/admin/moderation" className="text-xs font-medium text-primary-600 hover:underline">
            {t("moderation.legacyLink", "Admin moderation queue")} →
          </Link>
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-4 flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50">
        {queueTabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setQueue(key)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
              queue === key ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-900 dark:text-neutral-50" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {queue !== "audit" && (
        <div className="mb-4 flex gap-2 text-xs">
          {(["pending", "resolved", "escalated"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 font-semibold capitalize ${
                status === s ? "bg-primary-600 text-white" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
          ))
        ) : queue === "audit" ? (
          auditItems.length === 0 ? (
            <p className="py-12 text-center text-sm text-neutral-500">{t("moderation.noAuditEntries", "No moderation activity yet.")}</p>
          ) : (
            auditItems.map((a) => (
              <div key={a.id} className="rounded-xl border border-neutral-200 bg-white p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900">
                <p>
                  <span className="font-semibold capitalize">{a.action_type.replace(/_/g, " ")}</span>
                  {a.target_username && <> on @{a.target_username}</>}
                  {a.moderator_username && <> by @{a.moderator_username}</>}
                  <span className="text-neutral-400"> · {timeAgo(a.created_at)}</span>
                </p>
                {a.reason && <p className="mt-1 text-neutral-500">{a.reason}</p>}
                {a.reversed_at && (
                  <p className="mt-1 text-amber-600 dark:text-amber-400">
                    {t("moderation.reversedBy", "Reversed")}{a.reversed_by_username && <> by @{a.reversed_by_username}</>} · {timeAgo(a.reversed_at)}
                    {a.reversal_note && <> — {a.reversal_note}</>}
                  </p>
                )}
              </div>
            ))
          )
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white py-16 dark:border-neutral-800 dark:bg-neutral-900">
            <span className="text-4xl">✓</span>
            <p className="mt-3 text-sm text-neutral-500">{t("moderation.queueClear", "Queue is clear.")}</p>
          </div>
        ) : (
          items.map((item) => (
            <ReportCard
              key={item.id}
              item={item}
              queue={queue === "forum" ? "forum" : "reports"}
              isAdmin={isAdmin}
              busy={busy}
              onAction={handleAction}
              onReverse={handleReverse}
            />
          ))
        )}
      </div>
    </div>
  );
}
