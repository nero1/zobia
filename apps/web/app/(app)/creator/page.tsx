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

interface PayoutRecord {
  id: string;
  grossKobo: number;
  netKobo: number;
  platformFeeKobo: number;
  status: "pending" | "awaiting_approval" | "processing" | "completed" | "rejected" | string;
  method: string;
  region: string;
  bankAccountLast4: string | null;
  retryCount: number;
  appealStatus: string | null;
  rejectionReason: string | null;
  createdAt: string;
  completedAt: string | null;
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

interface PayoutConfig {
  bankTransferEnabled: boolean;
  coinsEnabled: boolean;
  cryptoEnabled: boolean;
  isManualMode: boolean;
  region: "nigeria" | "global";
}

interface PayoutsData {
  availableEarningsKobo: number;
  payoutConfig: PayoutConfig | null;
  bankAccount: { configured: boolean };
  walletAddress: { configured: boolean };
  pendingPayout: { id: string; method: string } | null;
  payouts: PayoutRecord[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNgn(kobo: number): string {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(kobo / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  awaiting_approval: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  processing: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  completed: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

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
// Payout section
// ---------------------------------------------------------------------------

interface PayoutSectionProps {
  payouts: PayoutsData;
  onRequest: (method: "bank_transfer" | "coins" | "crypto") => void;
  requesting: boolean;
  error: string | null;
}

function PayoutSection({ payouts, onRequest, requesting, error }: PayoutSectionProps) {
  const cfg = payouts.payoutConfig;
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Payouts</h2>
      </div>
      <div className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-800 dark:bg-teal-950/30">
          <div>
            <p className="text-xs text-teal-700 dark:text-teal-400">Available Balance</p>
            <p className="text-2xl font-bold text-teal-700 dark:text-teal-300">{formatNgn(payouts.availableEarningsKobo)}</p>
          </div>
          {!payouts.pendingPayout && cfg && (
            <div className="flex flex-wrap gap-2">
              {cfg.coinsEnabled && (
                <button
                  onClick={() => onRequest("coins")}
                  disabled={requesting}
                  className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                >
                  {requesting ? "Requesting…" : "Request (Coins)"}
                </button>
              )}
              {cfg.bankTransferEnabled && (
                <button
                  onClick={() => onRequest("bank_transfer")}
                  disabled={requesting || !payouts.bankAccount.configured}
                  className="rounded-xl border border-teal-600 px-4 py-2.5 text-sm font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-60 dark:text-teal-300 dark:hover:bg-teal-950/30"
                  title={!payouts.bankAccount.configured ? "Add a bank account first" : undefined}
                >
                  {requesting ? "Requesting…" : "Request (Bank)"}
                </button>
              )}
              {cfg.cryptoEnabled && (
                <button
                  onClick={() => onRequest("crypto")}
                  disabled={requesting || !payouts.walletAddress.configured}
                  className="rounded-xl border border-teal-600 px-4 py-2.5 text-sm font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-60 dark:text-teal-300 dark:hover:bg-teal-950/30"
                  title={!payouts.walletAddress.configured ? "Add a wallet address first" : undefined}
                >
                  {requesting ? "Requesting…" : "Request (Crypto)"}
                </button>
              )}
            </div>
          )}
        </div>

        {payouts.pendingPayout && (
          <p className="mb-3 text-xs text-neutral-500">
            A payout ({payouts.pendingPayout.method}) is already in progress.
          </p>
        )}
        {error && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

        {payouts.payouts.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
                  <th className="px-4 py-2.5 text-left font-semibold">Amount</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Method</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Requested</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {payouts.payouts.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                    <td className="px-4 py-3 font-medium tabular-nums text-neutral-900 dark:text-neutral-100">{formatNgn(p.netKobo)}</td>
                    <td className="px-4 py-3 capitalize text-neutral-500">{p.method.replace("_", " ")}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[p.status] ?? "bg-neutral-100 text-neutral-600"}`}>
                        {p.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{formatDate(p.createdAt)}</td>
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

  const [data, setData] = useState<CreatorDashboard | null>(null);
  const [payouts, setPayouts] = useState<PayoutsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [pendingMethod, setPendingMethod] = useState<"bank_transfer" | "coins" | "crypto" | null>(null);
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadPayouts = useCallback(async () => {
    const res = await fetch("/api/creator/payouts", { credentials: "include" });
    if (res.ok) setPayouts((await res.json()) as PayoutsData);
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
        await loadPayouts();
      } catch (e) {
        const err = e as Error & { code?: string | null };
        setError(e instanceof Error ? translateApiError(tRef.current, err.code, err.message || "Unknown error") : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadPayouts]);

  async function requestPayout(method: "bank_transfer" | "coins" | "crypto") {
    setPayoutError(null);
    setRequesting(true);
    try {
      const res = await fetch("/api/creator/payouts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 403 && body.code === "PIN_REQUIRED") {
          setPendingMethod(method);
          setShowPin(true);
          return;
        }
        const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
        const errCode = typeof body.error === "string" ? null : body.error?.code ?? null;
        const err = new Error(errMsg ?? body.message ?? "Failed to request payout") as Error & { code?: string | null };
        err.code = errCode;
        throw err;
      }
      const body = await res.json();
      showToast(body.message ?? "Payout requested — pending admin approval");
      await loadPayouts();
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setPayoutError(e instanceof Error ? translateApiError(t, err.code, err.message || "Error") : "Error");
    } finally {
      setRequesting(false);
    }
  }

  async function handlePinVerify() {
    if (pin.trim().length < 4 || !pendingMethod) return;
    setRequesting(true);
    try {
      const res = await fetch("/api/auth/pin/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() }),
      });
      if (!res.ok) throw new Error("Invalid PIN");
      setShowPin(false);
      setPin("");
      const method = pendingMethod;
      setPendingMethod(null);
      await requestPayout(method);
    } catch {
      setPayoutError(t("error.generic", "Something went wrong"));
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

  const streamEntries = Object.entries(data.revenue.byStream).filter(([, v]) => v > 0);

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

      {/* Payout section */}
      {payouts && (
        <PayoutSection
          payouts={payouts}
          onRequest={requestPayout}
          requesting={requesting}
          error={payoutError}
        />
      )}

      {showPin && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setShowPin(false)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-5 shadow-2xl dark:bg-neutral-900">
            <h3 className="mb-3 text-base font-bold text-neutral-900 dark:text-neutral-50">Enter your PIN</h3>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-center text-xl tracking-widest focus:border-primary-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              autoFocus
            />
            <div className="mt-4 flex gap-3">
              <button onClick={() => setShowPin(false)} className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
                Cancel
              </button>
              <button onClick={handlePinVerify} disabled={requesting || pin.length < 4} className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                Confirm
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
