"use client";

/**
 * app/(admin)/admin/financial/page.tsx
 *
 * Financial monitoring dashboard for the admin panel.
 * Shows coin economy breakdown, revenue by provider,
 * pending payout approvals, and alert banners.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FinancialSummary {
  coinsInCirculation: number;
  revenueThisMonth: number; // NGN
  pendingPayoutsCount: number;
  activeSubscriptions: number;
}

interface CoinBreakdown {
  purchasedPct: number;
  earnedPct: number;
  spentPct: number;
}

interface ProviderRevenue {
  provider: "Paystack" | "DodoPayments" | "Google Play";
  amount: number; // NGN
  transactionCount: number;
}

interface PendingPayout {
  id: string;
  creatorUsername: string;
  amountNgn: number;
  requestedAt: string;
}

interface FinancialData {
  summary: FinancialSummary;
  coinBreakdown: CoinBreakdown;
  providerRevenue: ProviderRevenue[];
  pendingPayouts: PendingPayout[];
  payoutBalanceLow: boolean;
  payoutBalanceThreshold: number;
  payoutBalance: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNgn(amount: number): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function SummarySkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-2 h-3 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-8 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

interface SummaryCardProps {
  label: string;
  value: string;
  icon: string;
  accent: string;
}

function SummaryCard({ label, value, icon, accent }: SummaryCardProps) {
  return (
    <div className={`rounded-xl border bg-white p-5 dark:bg-neutral-900 ${accent}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">{label}</p>
      </div>
      <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Economy breakdown bar
// ---------------------------------------------------------------------------

function EconomyBar({ breakdown }: { breakdown: CoinBreakdown }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-4 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Coin Economy Breakdown</h2>
      <div className="mb-3 flex h-5 overflow-hidden rounded-full">
        <div className="bg-blue-500" style={{ width: `${breakdown.purchasedPct}%` }} title={`Purchased: ${breakdown.purchasedPct}%`} />
        <div className="bg-teal-500" style={{ width: `${breakdown.earnedPct}%` }} title={`Earned: ${breakdown.earnedPct}%`} />
        <div className="bg-amber-500" style={{ width: `${breakdown.spentPct}%` }} title={`Spent: ${breakdown.spentPct}%`} />
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        {[
          { color: "bg-blue-500", label: "Purchased", pct: breakdown.purchasedPct },
          { color: "bg-teal-500", label: "Earned", pct: breakdown.earnedPct },
          { color: "bg-amber-500", label: "Spent", pct: breakdown.spentPct },
        ].map(({ color, label, pct }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
            <span className="text-neutral-600 dark:text-neutral-400">{label}</span>
            <span className="font-semibold text-neutral-900 dark:text-neutral-100">{pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payout row
// ---------------------------------------------------------------------------

interface PayoutRowProps {
  payout: PendingPayout;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  busy: string | null;
}

function PayoutRow({ payout, onApprove, onReject, busy }: PayoutRowProps) {
  const isBusy = busy === payout.id;
  return (
    <tr className="border-b border-neutral-100 last:border-0 dark:border-neutral-800">
      <td className="px-4 py-3 text-sm font-medium text-neutral-900 dark:text-neutral-100">@{payout.creatorUsername}</td>
      <td className="px-4 py-3 text-sm tabular-nums text-neutral-700 dark:text-neutral-300">{formatNgn(payout.amountNgn)}</td>
      <td className="px-4 py-3 text-sm text-neutral-500">{formatDate(payout.requestedAt)}</td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <button
            disabled={isBusy}
            onClick={() => onApprove(payout.id)}
            className="rounded-lg bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-200 disabled:opacity-50 dark:bg-teal-900 dark:text-teal-300"
          >
            {isBusy ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent inline-block" /> : "Approve"}
          </button>
          <button
            disabled={isBusy}
            onClick={() => onReject(payout.id)}
            className="rounded-lg bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900 dark:text-red-300"
          >
            Reject
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Admin financial monitoring page.
 * Requires admin authentication (enforced by middleware).
 */
export default function AdminFinancialPage() {
  const [data, setData] = useState<FinancialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/financial", { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/admin/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load financial data");
      setData((await res.json()) as FinancialData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  async function handlePayout(id: string, type: "approve" | "reject") {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/payouts/${id}/${type}`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to ${type} payout`);
      showToast(`Payout ${type}d`);
      await fetchData();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative space-y-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Financial Monitoring</h1>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {/* Low balance alert */}
      {data?.payoutBalanceLow && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950">
          <span className="text-xl">⚠️</span>
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Payout balance is low: <strong>{formatNgn(data.payoutBalance)}</strong> (threshold: {formatNgn(data.payoutBalanceThreshold)})
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Summary cards */}
      {loading ? (
        <SummarySkeleton />
      ) : data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Coins in Circulation" value={data.summary.coinsInCirculation.toLocaleString()} icon="🪙" accent="border-amber-200 dark:border-amber-800" />
          <SummaryCard label="Revenue This Month" value={formatNgn(data.summary.revenueThisMonth)} icon="💰" accent="border-teal-200 dark:border-teal-800" />
          <SummaryCard label="Pending Payouts" value={String(data.summary.pendingPayoutsCount)} icon="⏳" accent="border-blue-200 dark:border-blue-800" />
          <SummaryCard label="Active Subscriptions" value={data.summary.activeSubscriptions.toLocaleString()} icon="🔁" accent="border-neutral-200 dark:border-neutral-800" />
        </div>
      ) : null}

      {/* Coin economy bar */}
      {loading ? (
        <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-3 h-5 w-full rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className="flex gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-3 w-20 rounded bg-neutral-200 dark:bg-neutral-700" />
            ))}
          </div>
        </div>
      ) : data ? (
        <EconomyBar breakdown={data.coinBreakdown} />
      ) : null}

      {/* Revenue by provider */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Revenue by Provider</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 text-left font-semibold">Provider</th>
                <th className="px-5 py-3 text-right font-semibold">Amount (NGN)</th>
                <th className="px-5 py-3 text-right font-semibold">Transactions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {loading
                ? Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 3 }).map((__, j) => (
                      <td key={j} className="px-5 py-3">
                        <div className="h-4 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                      </td>
                    ))}
                  </tr>
                ))
                : data?.providerRevenue.map((r) => (
                  <tr key={r.provider} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                    <td className="px-5 py-3 font-medium text-neutral-900 dark:text-neutral-100">{r.provider}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{formatNgn(r.amount)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-neutral-500">{r.transactionCount.toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending payouts */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Pending Payout Approvals</h2>
          {data && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">{data.pendingPayouts.length}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3 text-left font-semibold">Creator</th>
                <th className="px-4 py-3 text-left font-semibold">Amount</th>
                <th className="px-4 py-3 text-left font-semibold">Requested</th>
                <th className="px-4 py-3 text-left font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-neutral-100 dark:border-neutral-800">
                    {Array.from({ length: 4 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : !data || data.pendingPayouts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-sm text-neutral-500">
                    No pending payouts
                  </td>
                </tr>
              ) : (
                data.pendingPayouts.map((p) => (
                  <PayoutRow
                    key={p.id}
                    payout={p}
                    onApprove={(id) => handlePayout(id, "approve")}
                    onReject={(id) => handlePayout(id, "reject")}
                    busy={busy}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
