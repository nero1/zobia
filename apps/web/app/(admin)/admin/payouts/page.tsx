"use client";

/**
 * app/(admin)/admin/payouts/page.tsx
 *
 * Creator payout management page for the admin panel.
 * Lists payouts by status and allows approve / reject actions.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Payout {
  id: string;
  creator: {
    id: string;
    username: string;
    email: string | null;
  };
  grossKobo: number;
  netKobo: number;
  platformFeeKobo: number;
  status: string;
  bankAccountLast4: string | null;
  createdAt: string;
}

type TabKey = "awaiting_approval" | "approved" | "rejected";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function koboToNgn(kobo: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(kobo / 100);
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const STATUS_BADGE: Record<string, string> = {
  awaiting_approval: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  approved: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  processing: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  completed: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function RowSkeleton() {
  return (
    <tr className="border-b border-neutral-100 dark:border-neutral-800">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Payout row
// ---------------------------------------------------------------------------

interface PayoutRowProps {
  payout: Payout;
  showActions: boolean;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  busy: string | null;
}

function PayoutRow({ payout, showActions, onApprove, onReject, busy }: PayoutRowProps) {
  const isBusy = busy === payout.id;
  const statusBadge = STATUS_BADGE[payout.status] ?? STATUS_BADGE.awaiting_approval;

  return (
    <tr className="border-b border-neutral-100 transition-colors hover:bg-neutral-50 last:border-0 dark:border-neutral-800 dark:hover:bg-neutral-800/50">
      <td className="px-4 py-3">
        <div className="font-medium text-neutral-900 dark:text-neutral-100">
          @{payout.creator.username}
        </div>
        {payout.creator.email && (
          <div className="truncate text-xs text-neutral-400 max-w-[160px]">
            {payout.creator.email}
          </div>
        )}
      </td>
      <td className="px-4 py-3 tabular-nums text-sm font-semibold text-neutral-800 dark:text-neutral-100">
        {koboToNgn(payout.grossKobo)}
      </td>
      <td className="px-4 py-3 tabular-nums text-sm text-teal-700 dark:text-teal-400">
        {koboToNgn(payout.netKobo)}
      </td>
      <td className="px-4 py-3 text-sm text-neutral-500">
        {payout.bankAccountLast4 ? (
          <span className="font-mono">••••&nbsp;{payout.bankAccountLast4}</span>
        ) : (
          <span className="text-neutral-300 dark:text-neutral-600">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadge}`}>
          {payout.status.replace(/_/g, " ")}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-neutral-500">
        <span title={payout.createdAt}>{timeAgo(payout.createdAt)}</span>
        <div className="text-neutral-400">{formatDate(payout.createdAt)}</div>
      </td>
      <td className="px-4 py-3">
        {showActions ? (
          <div className="flex gap-2">
            <button
              disabled={isBusy}
              onClick={() => onApprove(payout.id)}
              className="rounded-lg bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-700 transition-colors hover:bg-teal-200 disabled:opacity-50 dark:bg-teal-900 dark:text-teal-300"
            >
              {isBusy ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                "Approve"
              )}
            </button>
            <button
              disabled={isBusy}
              onClick={() => onReject(payout.id)}
              className="rounded-lg bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 transition-colors hover:bg-red-200 disabled:opacity-50 dark:bg-red-900 dark:text-red-300"
            >
              Reject
            </button>
          </div>
        ) : (
          <span className="text-xs text-neutral-400">—</span>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminPayoutsPage() {
  const [tab, setTab] = useState<TabKey>("awaiting_approval");
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchPayouts = useCallback(async (status: TabKey) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status, limit: "50", offset: "0" });
      const res = await fetch(`/api/admin/payouts?${params}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/admin/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load payouts");
      const data = (await res.json()) as { payouts: Payout[]; total: number };
      setPayouts(data.payouts);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPayouts(tab);
  }, [tab, fetchPayouts]);

  async function handlePayout(id: string, action: "approve" | "reject") {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/payouts/${id}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Failed to ${action} payout`);
      }
      showToast(`Payout ${action}d`);
      await fetchPayouts(tab);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error");
    } finally {
      setBusy(null);
    }
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "awaiting_approval", label: "Awaiting Approval" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <div className="relative">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        Creator Payouts
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

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 dark:border-neutral-800">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Creator</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Gross</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Net</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Bank Account</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => <RowSkeleton key={i} />)
              ) : payouts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-14 text-center text-sm text-neutral-500">
                    No {tab.replace(/_/g, " ")} payouts.
                  </td>
                </tr>
              ) : (
                payouts.map((p) => (
                  <PayoutRow
                    key={p.id}
                    payout={p}
                    showActions={tab === "awaiting_approval"}
                    onApprove={(id) => handlePayout(id, "approve")}
                    onReject={(id) => handlePayout(id, "reject")}
                    busy={busy}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer: record count */}
        {!loading && total > 0 && (
          <div className="border-t border-neutral-100 px-4 py-3 text-xs text-neutral-400 dark:border-neutral-800">
            {payouts.length} of {total} payouts
          </div>
        )}
      </div>
    </div>
  );
}
