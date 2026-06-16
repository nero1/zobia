"use client";

/**
 * app/(admin)/admin/automated-actions/page.tsx
 *
 * Automated moderation actions page for the admin panel.
 * Lists active and reversed automated moderation actions and
 * allows admins to reverse individual active actions.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AutomatedAction {
  id: string;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  target_user_id: string | null;
  metadata: Record<string, unknown> | null;
  reversed_at: string | null;
  reversed_by: string | null;
  reverse_note: string | null;
  created_at: string;
}

type TabKey = "active" | "reversed";

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
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ACTION_TYPE_BADGE: Record<string, string> = {
  content_removed: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  user_flagged: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  xp_stripped: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  user_suspended: "bg-red-200 text-red-800 dark:bg-red-950 dark:text-red-200",
  message_hidden: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

// ---------------------------------------------------------------------------
// Reverse Note Modal
// ---------------------------------------------------------------------------

interface ReverseModalProps {
  action: AutomatedAction;
  onClose: () => void;
  onConfirm: (actionId: string, note: string) => Promise<void>;
  submitting: boolean;
}

function ReverseModal({ action, onClose, onConfirm, submitting }: ReverseModalProps) {
  const [note, setNote] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onConfirm(action.id, note.trim());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-modal dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-1 text-lg font-bold text-neutral-900 dark:text-neutral-50">
          Reverse Action
        </h2>
        <p className="mb-5 text-sm text-neutral-500">
          Type:{" "}
          <span className="font-semibold text-neutral-700 dark:text-neutral-200">
            {action.action_type.replace(/_/g, " ")}
          </span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Admin Note (optional)
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="Reason for reversing this action…"
              className="w-full resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-50"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex flex-1 items-center justify-center rounded-lg bg-amber-600 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {submitting ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                "Reverse Action"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action card
// ---------------------------------------------------------------------------

interface ActionCardProps {
  action: AutomatedAction;
  showReverse: boolean;
  onReverse: (action: AutomatedAction) => void;
  busy: string | null;
}

function ActionCard({ action, showReverse, onReverse, busy }: ActionCardProps) {
  const isBusy = busy === action.id;
  const typeBadge = ACTION_TYPE_BADGE[action.action_type] ?? "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-0.5 font-semibold ${typeBadge}`}>
          {action.action_type.replace(/_/g, " ")}
        </span>
        {action.target_type && (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            {action.target_type}
          </span>
        )}
        <span className="ml-auto text-neutral-400">{timeAgo(action.created_at)}</span>
      </div>

      {/* Target info */}
      <div className="mb-3 space-y-0.5 text-xs text-neutral-500">
        {action.target_user_id && (
          <p>
            User ID:{" "}
            <span className="font-mono text-neutral-700 dark:text-neutral-300">
              {action.target_user_id}
            </span>
          </p>
        )}
        {action.target_id && (
          <p>
            Target ID:{" "}
            <span className="font-mono text-neutral-700 dark:text-neutral-300 truncate">
              {action.target_id}
            </span>
          </p>
        )}
        <p>Triggered: {formatDate(action.created_at)}</p>
      </div>

      {/* Metadata preview */}
      {action.metadata && Object.keys(action.metadata).length > 0 && (
        <div className="mb-3 overflow-hidden rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-800/50">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Metadata
          </p>
          {Object.entries(action.metadata).map(([k, v]) => (
            <p key={k} className="text-xs text-neutral-600 dark:text-neutral-400">
              <span className="font-medium">{k}:</span>{" "}
              {typeof v === "object" ? JSON.stringify(v) : String(v)}
            </p>
          ))}
        </div>
      )}

      {/* Reverse button or reversed info */}
      {showReverse ? (
        <button
          disabled={isBusy}
          onClick={() => onReverse(action)}
          className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-200 disabled:opacity-50 dark:bg-amber-900 dark:text-amber-300"
        >
          {isBusy ? (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            "Reverse"
          )}
        </button>
      ) : (
        action.reversed_at && (
          <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-2 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/50">
            Reversed {formatDate(action.reversed_at)}
            {action.reverse_note && (
              <p className="mt-0.5 italic">&ldquo;{action.reverse_note}&rdquo;</p>
            )}
          </div>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex gap-2">
        <div className="h-5 w-28 rounded-full bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-5 w-16 rounded-full bg-neutral-200 dark:bg-neutral-700" />
      </div>
      <div className="mb-2 h-3 w-3/4 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-3 w-1/2 rounded bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminAutomatedActionsPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [tab, setTab] = useState<TabKey>("active");
  const [items, setItems] = useState<AutomatedAction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reverseTarget, setReverseTarget] = useState<AutomatedAction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchActions = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNextCursor(null);
    try {
      const res = await fetch("/api/admin/automated-actions?limit=50", { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/admin/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load automated actions");
      const data = (await res.json()) as {
        items: AutomatedAction[];
        has_more: boolean;
        next_cursor: string | null;
      };
      // Split into active / reversed on the client since the API returns all
      setItems(data.items);
      setHasMore(data.has_more);
      setNextCursor(data.next_cursor);
    } catch (e) {
      setError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Unknown error") : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchActions();
  }, [fetchActions]);

  async function handleReverse(actionId: string, note: string) {
    setSubmitting(true);
    setBusy(actionId);
    try {
      const res = await fetch(`/api/admin/automated-actions/${actionId}/reverse`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        { const e2 = new Error((body as { error?: { message?: string }; message?: string }).error?.message ?? (body as { error?: string }).error as string ?? "Reversal failed") as Error & { code?: string | null }; e2.code = (body as { error?: { code?: string } }).error?.code ?? null; throw e2; };
      }
      showToast("Action reversed");
      setReverseTarget(null);
      await fetchActions();
    } catch (e) {
      showToast(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Reversal failed") : "Reversal failed", "error");
    } finally {
      setSubmitting(false);
      setBusy(null);
    }
  }

  const activeItems = items.filter((a) => a.reversed_at === null);
  const reversedItems = items.filter((a) => a.reversed_at !== null);
  const displayed = tab === "active" ? activeItems : reversedItems;

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "active", label: "Active", count: activeItems.length },
    { key: "reversed", label: "Reversed", count: reversedItems.length },
  ];

  return (
    <div className="relative">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        Automated Actions
      </h1>

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

      {/* Reverse modal */}
      {reverseTarget && (
        <ReverseModal
          action={reverseTarget}
          onClose={() => setReverseTarget(null)}
          onConfirm={handleReverse}
          submitting={submitting}
        />
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50">
        {tabs.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition-colors ${
              tab === key
                ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-900 dark:text-neutral-50"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {label}
            {!loading && (
              <span className={`rounded-full px-2 py-0.5 text-xs ${
                tab === key
                  ? "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                  : "bg-neutral-200 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400"
              }`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Has more notice */}
      {hasMore && nextCursor && (
        <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
          Showing most recent 50 actions. Use the API with cursor pagination to fetch more.
        </div>
      )}

      {/* Content */}
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white py-20 dark:border-neutral-800 dark:bg-neutral-900">
            <span className="text-4xl">{tab === "active" ? "✓" : "↩"}</span>
            <p className="mt-3 text-lg font-semibold text-neutral-700 dark:text-neutral-300">
              No {tab} actions
            </p>
            <p className="mt-1 text-sm text-neutral-500">
              {tab === "active"
                ? "No automated actions are currently active."
                : "No actions have been reversed yet."}
            </p>
          </div>
        ) : (
          displayed.map((a) => (
            <ActionCard
              key={a.id}
              action={a}
              showReverse={tab === "active"}
              onReverse={setReverseTarget}
              busy={busy}
            />
          ))
        )}
      </div>
    </div>
  );
}
