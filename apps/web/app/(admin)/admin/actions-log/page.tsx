"use client";

/**
 * app/(admin)/admin/actions-log/page.tsx
 *
 * Admin Automated Actions Log page.
 * Displays a filterable, paginated table of automated actions.
 * Allows admins to reverse an action with a reversal note.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionStatus = "active" | "reversed";

interface AutomatedAction {
  id: string;
  actionType: string;
  userId: string;
  username: string;
  description: string;
  createdAt: string;
  status: ActionStatus;
  reversedBy?: string | null;
  reversedAt?: string | null;
  reversalNote?: string | null;
}

interface ActionsLogResponse {
  actions: AutomatedAction[];
  nextCursor?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTION_TYPES = [
  "all",
  "auto_suspend",
  "auto_ban",
  "spam_filter",
  "content_removal",
  "rate_limit",
  "fraud_flag",
  "trust_score_drop",
  "other",
];

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function RowSkeleton() {
  return (
    <tr>
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Reversal Modal
// ---------------------------------------------------------------------------

interface ReversalModalProps {
  action: AutomatedAction;
  onClose: () => void;
  onConfirm: (actionId: string, note: string) => Promise<void>;
  reversing: boolean;
}

function ReversalModal({ action, onClose, onConfirm, reversing }: ReversalModalProps) {
  const [note, setNote] = useState("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-modal dark:border-neutral-800 dark:bg-neutral-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-50">Reverse Action</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Close"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-800/50">
            <p className="font-medium text-neutral-900 dark:text-neutral-100">{action.actionType.replace(/_/g, " ")}</p>
            <p className="mt-0.5 text-xs text-neutral-500">User: @{action.username} &middot; {timeAgo(action.createdAt)}</p>
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{action.description}</p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Reversal Note <span className="text-red-500">*</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Explain why this action is being reversed…"
              className="w-full resize-none rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm placeholder:text-neutral-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <button
            onClick={onClose}
            className="rounded-xl border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(action.id, note)}
            disabled={!note.trim() || reversing}
            className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {reversing ? "Reversing…" : "Confirm Reversal"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Admin Automated Actions Log — filterable table with reversal support.
 */
export default function AdminActionsLogPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [actions, setActions] = useState<AutomatedAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [userSearch, setUserSearch] = useState("");

  // Reversal modal
  const [reversalTarget, setReversalTarget] = useState<AutomatedAction | null>(null);
  const [reversing, setReversing] = useState(false);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchActions = useCallback(async (resetCursor = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (userSearch.trim()) params.set("user", userSearch.trim());
      if (!resetCursor && cursor) params.set("cursor", cursor);

      const res = await fetch(`/api/admin/actions-log?${params.toString()}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/admin/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load actions log");
      const data = (await res.json()) as ActionsLogResponse;
      setActions(data.actions ?? []);
      setNextCursor(data.nextCursor ?? null);
    } catch (e) {
      setError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Unknown error") : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, startDate, endDate, userSearch, cursor]);

  useEffect(() => {
    void fetchActions(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, startDate, endDate, userSearch]);

  async function handleReverse(actionId: string, note: string) {
    setReversing(true);
    try {
      const res = await fetch("/api/admin/actions-log", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, note }),
      });
      if (!res.ok) throw new Error("Reversal failed");
      showToast("Action reversed successfully");
      setReversalTarget(null);
      await fetchActions(true);
    } catch (e) {
      showToast(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Reversal failed") : "Reversal failed", "error");
    } finally {
      setReversing(false);
    }
  }

  function handleLoadMore() {
    if (nextCursor) {
      setCursor(nextCursor);
      void fetchActions(false);
    }
  }

  return (
    <div className="relative">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Automated Actions Log</h1>

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

      {/* Filters */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Type filter */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Action Type</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          >
            {ACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "All Types" : t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>

        {/* Start date */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">From Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>

        {/* End date */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">To Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>

        {/* User search */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">User Search</label>
          <input
            type="text"
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Search by username…"
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
              {["Action Type", "User", "Description", "Timestamp", "Status", ""].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => <RowSkeleton key={i} />)
            ) : actions.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-3xl">📋</span>
                    <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">No actions found</p>
                    <p className="text-xs text-neutral-400">Try adjusting your filters</p>
                  </div>
                </td>
              </tr>
            ) : (
              actions.map((action) => (
                <tr
                  key={action.id}
                  className={action.status === "reversed" ? "opacity-60" : ""}
                >
                  {/* Action Type */}
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                      {action.actionType.replace(/_/g, " ")}
                    </span>
                  </td>

                  {/* User */}
                  <td className="px-4 py-3">
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">@{action.username}</p>
                    <p className="text-xs text-neutral-400">{action.userId.slice(0, 8)}…</p>
                  </td>

                  {/* Description */}
                  <td className="max-w-xs px-4 py-3">
                    <p className={`text-sm ${action.status === "reversed" ? "line-through text-neutral-400" : "text-neutral-700 dark:text-neutral-300"}`}>
                      {action.description}
                    </p>
                    {action.status === "reversed" && action.reversedBy && (
                      <p className="mt-1 text-xs text-neutral-400">
                        Reversed by @{action.reversedBy}
                        {action.reversalNote && ` · "${action.reversalNote}"`}
                      </p>
                    )}
                  </td>

                  {/* Timestamp */}
                  <td className="px-4 py-3 text-xs text-neutral-500">
                    {formatDate(action.createdAt)}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    {action.status === "active" ? (
                      <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">
                        Active
                      </span>
                    ) : (
                      <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                        Reversed
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    {action.status === "active" && (
                      <button
                        onClick={() => setReversalTarget(action)}
                        className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-300 dark:hover:bg-amber-800"
                      >
                        Reverse
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {nextCursor && !loading && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={handleLoadMore}
            className="rounded-xl border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Load More
          </button>
        </div>
      )}

      {/* Reversal modal */}
      {reversalTarget && (
        <ReversalModal
          action={reversalTarget}
          onClose={() => setReversalTarget(null)}
          onConfirm={handleReverse}
          reversing={reversing}
        />
      )}
    </div>
  );
}
