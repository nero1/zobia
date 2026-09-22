"use client";

/**
 * app/(app)/creator/page.tsx
 *
 * Creator dashboard (web version).
 * Revenue summary cards, revenue-by-stream breakdown, member stats, top
 * gifters, and payout section.
 * Only accessible if is_creator = true.
 *
 * ZSB-02 fix: this page previously read field names (`revenue.thisWeek`,
 * `dailyRevenue`, `revenueStreams` (as an array, `.map()`ed unguarded),
 * `totalMembers`, `activeMembersPct`, `payoutBalance`, `topGifters[].userId`)
 * that don't exist anywhere in GET /api/creator/dashboard's actual response
 * shape — a hard crash for every creator who opened this page. It now reads
 * the real shape (`revenue.week`/`month`/`byStream`, `members.total`/`active`,
 * `topGifters[].user_id`/`avatar_emoji`/`total_coins`) and fetches payout
 * balance/history/request from the separate `/api/creator/payouts` endpoint
 * (which also requires a PIN verification before a payout can be requested),
 * mirroring the already-correct contract in
 * apps/android/src/routes/creator/index.tsx.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { CreatorPayoutPanel } from "@/components/creator/CreatorPayoutPanel";

// ---------------------------------------------------------------------------
// Types (mirrors GET /api/creator/dashboard and GET/POST /api/creator/payouts)
// ---------------------------------------------------------------------------

interface RevenueCards {
  today: number;
  week: number;
  month: number;
  allTime: number;
  byStream: Record<string, number>;
}

interface MemberStats {
  total: number;
  active: number;
  churnRate: number;
  avgSessionTime: number | null;
}

interface TopGifter {
  user_id: string;
  username: string;
  display_name: string;
  avatar_emoji: string;
  total_coins: number;
}

interface QuestPerformance {
  completed: number;
  pending: number;
}

interface CreatorDashboard {
  isCreator: boolean;
  revenue: RevenueCards;
  members: MemberStats;
  topGifters: TopGifter[];
  questPerformance: QuestPerformance;
  payoutHistory: unknown[]; // superseded by /api/creator/payouts's richer `payouts` list
  roomHealthScore: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNgn(kobo: number): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(kobo / 100);
}

const STREAM_LABEL: Record<string, string> = {
  gift: "🎁 Gifts",
  subscription: "🔁 Subscriptions",
  dropEntry: "🎟️ Drop Entries",
  classroomEnrolment: "📚 Classroom",
  sponsoredQuest: "🏆 Sponsored Quests",
  merch: "🛍️ Merch",
  creatorFund: "💰 Creator Fund",
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

  const [data, setData] = useState<CreatorDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        const d = (await res.json()) as CreatorDashboard;
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

  const streamEntries = Object.entries(data.revenue.byStream).filter(([, v]) => v > 0);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Creator Dashboard</h1>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/creator/merch" className="rounded-full border border-neutral-200 px-3 py-1.5 font-medium text-neutral-700 hover:border-blue-300 hover:text-blue-600 dark:border-neutral-700 dark:text-neutral-300">🛍️ Merch Store</Link>
        <Link href="/creator/wallet" className="rounded-full border border-neutral-200 px-3 py-1.5 font-medium text-neutral-700 hover:border-blue-300 hover:text-blue-600 dark:border-neutral-700 dark:text-neutral-300">👛 Wallet</Link>
        <Link href="/creator/bank-account" className="rounded-full border border-neutral-200 px-3 py-1.5 font-medium text-neutral-700 hover:border-blue-300 hover:text-blue-600 dark:border-neutral-700 dark:text-neutral-300">🏦 Bank Account</Link>
        <Link href="/creator/broadcasts" className="rounded-full border border-neutral-200 px-3 py-1.5 font-medium text-neutral-700 hover:border-blue-300 hover:text-blue-600 dark:border-neutral-700 dark:text-neutral-300">📣 Broadcasts</Link>
        <Link href="/classroom/studio" className="rounded-full border border-neutral-200 px-3 py-1.5 font-medium text-neutral-700 hover:border-blue-300 hover:text-blue-600 dark:border-neutral-700 dark:text-neutral-300">📚 {t("classroom.nav.studio", "Classroom Studio")}</Link>
        <Link href="/market" className="rounded-full border border-neutral-200 px-3 py-1.5 font-medium text-neutral-700 hover:border-blue-300 hover:text-blue-600 dark:border-neutral-700 dark:text-neutral-300">🏪 Market</Link>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {/* Revenue cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <RevenueCard label="Today" value={data.revenue.today} />
        <RevenueCard label="This Week" value={data.revenue.week} />
        <RevenueCard label="This Month" value={data.revenue.month} />
        <RevenueCard label="All Time" value={data.revenue.allTime} />
      </div>

      {/* Revenue streams */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Revenue by Stream (All Time)</h2>
        </div>
        {streamEntries.length > 0 ? (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {streamEntries.map(([key, value]) => (
              <div key={key} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="text-neutral-700 dark:text-neutral-300">{STREAM_LABEL[key] ?? key}</span>
                <span className="font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{formatNgn(value)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-4 text-sm text-neutral-500">No revenue yet.</p>
        )}
      </div>

      {/* Members */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Members</h2>
        </div>
        <div className="p-5">
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <p className="text-xs text-neutral-500">Total Members</p>
              <p className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{data.members.total.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <p className="text-xs text-neutral-500">Active (7d)</p>
              <p className="text-xl font-bold text-teal-600">{data.members.active.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <p className="text-xs text-neutral-500">Churn Rate</p>
              <p className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{data.members.churnRate}%</p>
            </div>
            <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <p className="text-xs text-neutral-500">Room Health</p>
              <p className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{data.roomHealthScore}</p>
            </div>
          </div>

          {data.topGifters.length > 0 && (
            <>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">Top Gifters</p>
              <div className="space-y-2">
                {data.topGifters.map((g, i) => (
                  <Link
                    key={g.user_id}
                    href={`/profile/${g.username}`}
                    className="flex items-center gap-3 rounded-lg border border-neutral-100 p-2.5 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/50"
                  >
                    <span className="w-5 text-center text-xs font-bold text-neutral-400">#{i + 1}</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">{g.avatar_emoji}</span>
                    <span className="flex-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">@{g.username}</span>
                    <span className="text-sm font-bold text-amber-600">{g.total_coins.toLocaleString()} 🪙</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Payout section — shared with the Classroom Creator Studio */}
      <CreatorPayoutPanel onToast={showToast} />
    </div>
  );
}
