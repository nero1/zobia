"use client";

/**
 * app/(app)/creator/page.tsx
 *
 * Creator dashboard (web version).
 * Revenue summary cards, CSS bar chart, revenue stream breakdown,
 * member stats, top gifters, and payout section.
 * Only accessible if is_creator = true.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RevenueCards {
  today: number;
  thisWeek: number;
  thisMonth: number;
  allTime: number;
}

interface DailyRevenue {
  date: string; // "YYYY-MM-DD"
  amount: number;
}

interface RevenueStream {
  source: string;
  amount: number;
  count: number;
}

interface TopGifter {
  userId: string;
  username: string;
  avatarEmoji: string;
  totalGifted: number;
}

interface PayoutRecord {
  id: string;
  amount: number;
  status: "pending" | "approved" | "paid" | "rejected";
  requestedAt: string;
  processedAt: string | null;
}

interface CreatorData {
  isCreator: boolean;
  revenue: RevenueCards;
  dailyRevenue: DailyRevenue[]; // last 30 days
  revenueStreams: RevenueStream[];
  totalMembers: number;
  activeMembersPct: number;
  topGifters: TopGifter[];
  payoutBalance: number; // NGN
  payoutHistory: PayoutRecord[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNgn(amount: number): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  approved: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  paid: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

const STREAM_EMOJI: Record<string, string> = {
  Gift: "🎁",
  Subscription: "🔁",
  "Drop Entry": "🎟️",
  ClassRoom: "📚",
  "Sponsored Quest": "🏆",
  "Creator Fund": "💰",
};

// ---------------------------------------------------------------------------
// Revenue card
// ---------------------------------------------------------------------------

function RevenueCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-neutral-900 dark:text-neutral-50">{formatNgn(value)}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSS bar chart (no external library)
// ---------------------------------------------------------------------------

function RevenueChart({ daily }: { daily: DailyRevenue[] }) {
  const last14 = daily.slice(-14);
  const max = Math.max(...last14.map((d) => d.amount), 1);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-4 text-sm font-semibold text-neutral-700 dark:text-neutral-300">Revenue (Last 14 Days)</h2>
      <div className="flex h-32 items-end gap-1">
        {last14.map((d) => {
          const heightPct = Math.round((d.amount / max) * 100);
          return (
            <div
              key={d.date}
              className="group relative flex flex-1 flex-col items-center justify-end"
              title={`${new Date(d.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}: ${formatNgn(d.amount)}`}
            >
              <div
                className="w-full rounded-t bg-blue-500 transition-all group-hover:bg-blue-600"
                style={{ height: `${Math.max(heightPct, 2)}%` }}
              />
              <span className="absolute -top-5 hidden rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-white group-hover:block dark:bg-neutral-700">
                {formatNgn(d.amount)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-neutral-400">
        <span>
          {last14[0]
            ? new Date(last14[0].date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
            : ""}
        </span>
        <span>
          {last14[last14.length - 1]
            ? new Date(last14[last14.length - 1].date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
            : ""}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payout section
// ---------------------------------------------------------------------------

interface PayoutSectionProps {
  balance: number;
  history: PayoutRecord[];
  onRequest: () => Promise<void>;
  requesting: boolean;
}

function PayoutSection({ balance, history, onRequest, requesting }: PayoutSectionProps) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Payouts</h2>
      </div>
      <div className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-800 dark:bg-teal-950/30">
          <div>
            <p className="text-xs text-teal-700 dark:text-teal-400">Available Balance</p>
            <p className="text-2xl font-bold text-teal-700 dark:text-teal-300">{formatNgn(balance)}</p>
          </div>
          <button
            onClick={onRequest}
            disabled={requesting || balance < 1000}
            className="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {requesting ? "Requesting…" : "Request Payout"}
          </button>
        </div>
        {balance < 1000 && (
          <p className="mb-3 text-xs text-neutral-500">Minimum payout: ₦1,000</p>
        )}

        {history.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
                  <th className="px-4 py-2.5 text-left font-semibold">Amount</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Requested</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Processed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {history.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                    <td className="px-4 py-3 font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{formatNgn(p.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[p.status]}`}>{p.status}</span>
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{formatDate(p.requestedAt)}</td>
                    <td className="px-4 py-3 text-neutral-500">{p.processedAt ? formatDate(p.processedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Creator dashboard page.
 * Only accessible when is_creator = true (checked server-side and client-side).
 */
export default function CreatorPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const [data, setData] = useState<CreatorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/creator/dashboard", { credentials: "include" });
        if (res.status === 401) { window.location.href = "/auth/login"; return; }
        if (res.status === 403) { window.location.href = "/home"; return; }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
          const errCode = typeof body.error === "string" ? null : body.error?.code ?? null;
          const err = new Error(errMsg ?? body.message ?? "Failed to load dashboard") as Error & { code?: string | null };
          err.code = errCode;
          throw err;
        }
        const d = (await res.json()) as CreatorData;
        if (!d.isCreator) { window.location.href = "/home"; return; }
        setData(d);
      } catch (e) {
        const err = e as Error & { code?: string | null };
        setError(e instanceof Error ? translateApiError(tRef.current, err.code, err.message || "Unknown error") : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handlePayoutRequest() {
    setRequesting(true);
    try {
      const res = await fetch("/api/creator/payouts", { method: "POST", credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
        const errCode = typeof body.error === "string" ? null : body.error?.code ?? null;
        const err = new Error(errMsg ?? body.message ?? "Failed to request payout") as Error & { code?: string | null };
        err.code = errCode;
        throw err;
      }
      showToast("Payout requested — pending admin approval");
      const refreshed = await fetch("/api/creator/dashboard", { credentials: "include" });
      setData((await refreshed.json()) as CreatorData);
    } catch (e) {
      const err = e as Error & { code?: string | null };
      showToast(e instanceof Error ? translateApiError(t, err.code, err.message || "Error") : "Error", "error");
    } finally {
      setRequesting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
        <div className="h-8 w-40 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="mb-2 h-3 w-20 rounded bg-neutral-200 dark:bg-neutral-700" />
              <div className="h-7 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
            </div>
          ))}
        </div>
        <div className="h-48 animate-pulse rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error ?? "Access denied"}
        </div>
        <Link href="/home" className="mt-3 inline-block text-sm text-blue-600 hover:underline">← Home</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Creator Dashboard</h1>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {/* Revenue cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <RevenueCard label="Today" value={data.revenue.today} />
        <RevenueCard label="This Week" value={data.revenue.thisWeek} />
        <RevenueCard label="This Month" value={data.revenue.thisMonth} />
        <RevenueCard label="All Time" value={data.revenue.allTime} />
      </div>

      {/* Revenue chart */}
      <RevenueChart daily={data.dailyRevenue} />

      {/* Revenue streams */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Revenue by Stream</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-neutral-500">
                <th className="px-5 py-3 text-left font-semibold">Source</th>
                <th className="px-5 py-3 text-right font-semibold">Revenue</th>
                <th className="px-5 py-3 text-right font-semibold">Transactions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {data.revenueStreams.map((s) => (
                <tr key={s.source} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                  <td className="px-5 py-3 font-medium text-neutral-900 dark:text-neutral-100">
                    <span className="mr-2">{STREAM_EMOJI[s.source] ?? "💼"}</span>{s.source}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-neutral-700 dark:text-neutral-300">{formatNgn(s.amount)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-neutral-500">{s.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Members */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Members</h2>
        </div>
        <div className="p-5">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <p className="text-xs text-neutral-500">Total Members</p>
              <p className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{data.totalMembers.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <p className="text-xs text-neutral-500">Active (30d)</p>
              <p className="text-xl font-bold text-teal-600">{data.activeMembersPct}%</p>
            </div>
          </div>

          {data.topGifters.length > 0 && (
            <>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Top Gifters</p>
              <div className="space-y-2">
                {data.topGifters.map((g, i) => (
                  <Link
                    key={g.userId}
                    href={`/profile/${g.userId}`}
                    className="flex items-center gap-3 rounded-lg border border-neutral-100 p-2.5 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
                  >
                    <span className="w-5 text-center text-xs font-bold text-neutral-400">#{i + 1}</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">{g.avatarEmoji}</span>
                    <span className="flex-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">@{g.username}</span>
                    <span className="text-sm font-bold text-amber-600">{g.totalGifted.toLocaleString()} 🪙</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Payout section */}
      <PayoutSection
        balance={data.payoutBalance}
        history={data.payoutHistory}
        onRequest={handlePayoutRequest}
        requesting={requesting}
      />
    </div>
  );
}
