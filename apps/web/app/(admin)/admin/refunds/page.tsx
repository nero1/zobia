"use client";

/**
 * app/(admin)/admin/refunds/page.tsx
 *
 * Coin refunds management page for the admin panel.
 * Lists coin purchase transactions and processed refunds.
 * Allows issuing a new refund via an inline form/modal.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RefundRecord {
  id: string;
  user_id: string;
  username: string | null;
  amount_coins: number;
  reason: string;
  reference_id: string;
  status: string;
  processed_by: string | null;
  created_at: string;
  processed_at: string | null;
}

type TabKey = "pending" | "processed";

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
  });
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function RowSkeleton() {
  return (
    <tr className="border-b border-neutral-100 dark:border-neutral-800">
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Refund Modal
// ---------------------------------------------------------------------------

interface RefundModalProps {
  record: RefundRecord;
  onClose: () => void;
  onSubmit: (userId: string, amountCoins: number, reason: string, referenceId: string) => Promise<void>;
  submitting: boolean;
}

function RefundModal({ record, onClose, onSubmit, submitting }: RefundModalProps) {
  const [amount, setAmount] = useState<string>(String(record.amount_coins));
  const [reason, setReason] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsed = parseInt(amount, 10);
    if (isNaN(parsed) || parsed < 1) {
      setFormError("Amount must be a positive whole number.");
      return;
    }
    if (!reason.trim() || reason.trim().length < 5) {
      setFormError("Please enter a reason (at least 5 characters).");
      return;
    }

    await onSubmit(record.user_id, parsed, reason.trim(), record.reference_id);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-modal dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-1 text-lg font-bold text-neutral-900 dark:text-neutral-50">Issue Refund</h2>
        <p className="mb-5 text-sm text-neutral-500">
          User: <span className="font-semibold text-neutral-700 dark:text-neutral-200">@{record.username ?? record.user_id}</span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Amount (coins)
            </label>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Reason
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this refund is being issued…"
              className="w-full resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-50"
            />
          </div>

          {formError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {formError}
            </p>
          )}

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
              className="flex flex-1 items-center justify-center rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                "Issue Refund"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminRefundsPage() {
  const [tab, setTab] = useState<TabKey>("pending");
  const [records, setRecords] = useState<RefundRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [modal, setModal] = useState<RefundRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchRecords = useCallback(async (status: TabKey) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status, limit: "50", offset: "0" });
      const res = await fetch(`/api/admin/refunds?${params}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/admin/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load refunds");
      const data = (await res.json()) as { success: boolean; data: { refunds: RefundRecord[]; total: number } };
      setRecords(data.data.refunds);
      setTotal(data.data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRecords(tab);
  }, [tab, fetchRecords]);

  async function handleIssueRefund(userId: string, amountCoins: number, reason: string, referenceId: string) {
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/refunds", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, amountCoins, reason, referenceId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Refund failed");
      }
      showToast("Refund issued successfully");
      setModal(null);
      await fetchRecords(tab);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Refund failed", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const filtered = debouncedSearch
    ? records.filter((r) =>
        (r.username ?? "").toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        r.user_id.toLowerCase().includes(debouncedSearch.toLowerCase())
      )
    : records;

  const tabs: { key: TabKey; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "processed", label: "Processed" },
  ];

  return (
    <div className="relative">
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

      {/* Modal */}
      {modal && (
        <RefundModal
          record={modal}
          onClose={() => setModal(null)}
          onSubmit={handleIssueRefund}
          submitting={submitting}
        />
      )}

      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Coin Refunds</h1>

      {/* Tabs + search */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-lg px-5 py-2 text-sm font-semibold transition-colors ${
                tab === key
                  ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-900 dark:text-neutral-50"
                  : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          type="search"
          placeholder="Search by username…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-50 sm:w-64"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 dark:border-neutral-800">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Reason</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => <RowSkeleton key={i} />)
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-14 text-center text-sm text-neutral-500">
                    {debouncedSearch ? "No results match your search." : `No ${tab} refunds.`}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-900 dark:text-neutral-100">
                        @{r.username ?? "—"}
                      </div>
                      <div className="text-xs text-neutral-400 truncate max-w-[120px]">{r.user_id}</div>
                    </td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-amber-600 dark:text-amber-400">
                      {r.amount_coins.toLocaleString()} coins
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      <p className="truncate text-neutral-700 dark:text-neutral-300" title={r.reason}>
                        {r.reason}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-500">
                      <span title={r.created_at}>{timeAgo(r.created_at)}</span>
                      <div className="text-neutral-400">{formatDate(r.created_at)}</div>
                    </td>
                    <td className="px-4 py-3">
                      {r.status === "pending" ? (
                        <button
                          onClick={() => setModal(r)}
                          className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300"
                        >
                          Issue Refund
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">
                          Processed
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer: record count */}
        {!loading && total > 0 && (
          <div className="border-t border-neutral-100 px-4 py-3 text-xs text-neutral-400 dark:border-neutral-800">
            Showing {filtered.length} of {total} records
          </div>
        )}
      </div>
    </div>
  );
}
