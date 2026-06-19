"use client";

/**
 * app/(admin)/admin/financial/page.tsx
 *
 * Financial monitoring dashboard for the admin panel.
 * Shows coin economy breakdown, revenue by provider,
 * pending payout approvals, and alert banners.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types — match the actual /api/admin/financial response shape
// ---------------------------------------------------------------------------

interface CoinEconomy {
  totalCoinsInCirculation: number;
  purchasedToday: number;
  purchasedWeek: number;
  purchasedMonth: number;
  burnedToday: number;
  burnedWeek: number;
  burnedMonth: number;
  earnedToday: number;
  earnedWeek: number;
  earnedMonth: number;
  usersWithCoins: number;
}

interface ProviderRevenueRow {
  provider: string;
  revenueToday: number;
  revenueWeek: number;
  revenueMonth: number;
  transactionCount: number;
}

interface PayoutSummary {
  awaitingApproval: { count: number; grossKobo: number };
  processing: { count: number; grossKobo: number };
  completedThisMonthNetKobo: number;
}

interface AnomalyAlert {
  level: "info" | "warning" | "critical";
  code: string;
  message: string;
}

interface FinancialData {
  coinEconomy: CoinEconomy;
  revenueByProvider: ProviderRevenueRow[];
  payoutSummary: PayoutSummary;
  anomalyAlerts: AnomalyAlert[];
  generatedAt: string;
}

// Derived helpers
function koboToNgn(kobo: number): number { return kobo / 100; }

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
// Economy breakdown bar — computed from CoinEconomy
// ---------------------------------------------------------------------------

function EconomyBar({ economy }: { economy: CoinEconomy }) {
  const total = economy.purchasedMonth + economy.earnedMonth + economy.burnedMonth;
  const purchasedPct = total > 0 ? Math.round((economy.purchasedMonth / total) * 100) : 0;
  const earnedPct = total > 0 ? Math.round((economy.earnedMonth / total) * 100) : 0;
  const spentPct = total > 0 ? Math.min(100 - purchasedPct - earnedPct, Math.round((economy.burnedMonth / total) * 100)) : 0;
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-4 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Coin Economy (30-day)</h2>
      <div className="mb-3 flex h-5 overflow-hidden rounded-full">
        <div className="bg-blue-500" style={{ width: `${purchasedPct}%` }} title={`Purchased: ${purchasedPct}%`} />
        <div className="bg-teal-500" style={{ width: `${earnedPct}%` }} title={`Earned: ${earnedPct}%`} />
        <div className="bg-amber-500" style={{ width: `${spentPct}%` }} title={`Spent: ${spentPct}%`} />
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        {[
          { color: "bg-blue-500", label: "Purchased", pct: purchasedPct },
          { color: "bg-teal-500", label: "Earned", pct: earnedPct },
          { color: "bg-amber-500", label: "Spent/Burned", pct: spentPct },
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
// Anomaly alert banner
// ---------------------------------------------------------------------------

function AnomalyBanner({ alert }: { alert: AnomalyAlert }) {
  const styles = {
    critical: "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
    warning:  "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
    info:     "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200",
  };
  const icons = { critical: "🚨", warning: "⚠️", info: "ℹ️" };
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${styles[alert.level]}`}>
      <span className="text-lg">{icons[alert.level]}</span>
      <p className="text-sm">{alert.message}</p>
    </div>
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
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const currency = useCurrency();
  const [data, setData] = useState<FinancialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      setError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Unknown error") : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  return (
    <div className="relative space-y-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Financial Monitoring</h1>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Anomaly alerts */}
      {data?.anomalyAlerts && data.anomalyAlerts.length > 0 && (
        <div className="space-y-2">
          {data.anomalyAlerts.map((a) => <AnomalyBanner key={a.code} alert={a} />)}
        </div>
      )}

      {/* Summary cards */}
      {loading ? (
        <SummarySkeleton />
      ) : data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label={`${currency.softPlural} in Circulation`}
            value={data.coinEconomy.totalCoinsInCirculation.toLocaleString()}
            icon="🪙"
            accent="border-amber-200 dark:border-amber-800"
          />
          <SummaryCard
            label="Revenue This Month"
            value={formatNgn(koboToNgn(data.revenueByProvider.reduce((sum, r) => sum + r.revenueMonth, 0)))}
            icon="💰"
            accent="border-teal-200 dark:border-teal-800"
          />
          <SummaryCard
            label="Pending Payout Approvals"
            value={String(data.payoutSummary.awaitingApproval.count)}
            icon="⏳"
            accent="border-blue-200 dark:border-blue-800"
          />
          <SummaryCard
            label="Users With Coins"
            value={data.coinEconomy.usersWithCoins.toLocaleString()}
            icon="👥"
            accent="border-neutral-200 dark:border-neutral-800"
          />
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
        <EconomyBar economy={data.coinEconomy} />
      ) : null}

      {/* Payout summary */}
      {data && (
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Awaiting Approval", count: data.payoutSummary.awaitingApproval.count, gross: koboToNgn(data.payoutSummary.awaitingApproval.grossKobo), accent: "border-amber-200 dark:border-amber-800" },
            { label: "Processing", count: data.payoutSummary.processing.count, gross: koboToNgn(data.payoutSummary.processing.grossKobo), accent: "border-blue-200 dark:border-blue-800" },
            { label: "Completed This Month", count: null, gross: koboToNgn(data.payoutSummary.completedThisMonthNetKobo), accent: "border-teal-200 dark:border-teal-800" },
          ].map(({ label, count, gross, accent }) => (
            <div key={label} className={`rounded-xl border bg-white p-4 dark:bg-neutral-900 ${accent}`}>
              <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">{label}</p>
              {count !== null && <p className="text-lg font-bold text-neutral-900 dark:text-neutral-50">{count} payouts</p>}
              <p className="text-sm font-semibold text-teal-600">{formatNgn(gross)}</p>
            </div>
          ))}
        </div>
      )}

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
                <th className="px-5 py-3 text-right font-semibold">Today (NGN)</th>
                <th className="px-5 py-3 text-right font-semibold">This Month (NGN)</th>
                <th className="px-5 py-3 text-right font-semibold">Transactions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {loading
                ? Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 4 }).map((__, j) => (
                      <td key={j} className="px-5 py-3">
                        <div className="h-4 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                      </td>
                    ))}
                  </tr>
                ))
                : data?.revenueByProvider.map((r) => (
                  <tr key={r.provider} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                    <td className="px-5 py-3 font-medium text-neutral-900 dark:text-neutral-100">{r.provider}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{formatNgn(koboToNgn(r.revenueToday))}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{formatNgn(koboToNgn(r.revenueMonth))}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-neutral-500">{r.transactionCount.toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
