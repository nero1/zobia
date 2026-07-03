/**
 * apps/android/src/routes/creator/index.tsx
 *
 * Creator dashboard — mirrors apps/web/app/(app)/creator/page.tsx: revenue
 * summary, revenue-by-stream breakdown, member stats, top gifters, and
 * payout balance/history/request.
 *
 * CONTRACT FIXES (see report):
 *  - apps/web/app/api/creator/dashboard/route.ts's payload had no
 *    `isCreator` field even though the web page redirects away when
 *    `!d.isCreator` — real creators were bounced off their own dashboard.
 *    Fixed by adding `isCreator: true` to the response (the route already
 *    verifies is_creator server-side before returning any data).
 *  - The web page also assumed field names (revenue.thisWeek/thisMonth,
 *    dailyRevenue[], revenueStreams[], totalMembers, activeMembersPct,
 *    payoutBalance, payoutHistory) that don't match what the dashboard route
 *    actually returns (revenue.week/month, revenue.byStream{}, members.total/
 *    active/churnRate — and payout balance/history live on a *separate*
 *    endpoint, GET /api/creator/payouts, not on the dashboard route at all).
 *    That's a bigger rewrite than a targeted fix, so it's left broken on web
 *    (flagged in report) — this Android page uses the real shapes instead of
 *    porting the same bug.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface CreatorDashboard {
  isCreator: boolean;
  revenue: {
    today: number;
    week: number;
    month: number;
    allTime: number;
    byStream: Record<string, number>;
  };
  members: { total: number; active: number; churnRate: number; avgSessionTime: number | null };
  topGifters: Array<{ user_id: string; username: string; display_name: string; avatar_emoji: string; total_coins: number }>;
  questPerformance: { completed: number; pending: number };
  payoutHistory: Array<{ id: string; amount_kobo: number; status: string; provider: string; created_at: string; processed_at: string | null }>;
  roomHealthScore: number;
}

interface PayoutsData {
  availableEarningsKobo: number;
  payoutConfig: { bankTransferEnabled: boolean; coinsEnabled: boolean; cryptoEnabled: boolean; isManualMode: boolean } | null;
  pendingPayout: { id: string; method: string } | null;
  payouts: Array<{ id: string; grossKobo: number; netKobo: number; status: string; method: string; createdAt: string; completedAt: string | null }>;
}

const STREAM_LABEL: Record<string, string> = {
  gift: '🎁 Gifts',
  subscription: '🔁 Subscriptions',
  dropEntry: '🎟️ Drop Entries',
  classroomEnrolment: '📚 Classroom',
  sponsoredQuest: '🏆 Sponsored Quests',
  merch: '🛍️ Merch',
  creatorFund: '💰 Creator Fund',
};

function formatNgn(kobo: number): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(kobo / 100);
}

async function fetchDashboard(): Promise<CreatorDashboard> {
  const { data } = await apiClient.get<CreatorDashboard>('/creator/dashboard');
  return data;
}

async function fetchPayouts(): Promise<PayoutsData> {
  const { data } = await apiClient.get<PayoutsData>('/creator/payouts');
  return data;
}

function CreatorDashboardPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [requesting, setRequesting] = useState(false);
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [pendingMethod, setPendingMethod] = useState<'bank_transfer' | 'coins' | 'crypto' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, status } = useQuery({ queryKey: ['creator', 'dashboard'], queryFn: fetchDashboard });
  const { data: payouts, status: payoutsStatus } = useQuery({ queryKey: ['creator', 'payouts'], queryFn: fetchPayouts });

  async function requestPayout(method: 'bank_transfer' | 'coins' | 'crypto') {
    setError(null);
    setRequesting(true);
    try {
      await apiClient.post('/creator/payouts', { method });
      qc.invalidateQueries({ queryKey: ['creator', 'payouts'] });
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { code?: string; error?: string } } };
      if (e.response?.status === 403 && e.response.data?.code === 'PIN_REQUIRED') {
        setPendingMethod(method);
        setShowPin(true);
      } else {
        setError(t('error.generic'));
      }
    } finally {
      setRequesting(false);
    }
  }

  async function handlePinVerify() {
    if (pin.trim().length < 4 || !pendingMethod) return;
    setRequesting(true);
    try {
      await apiClient.post('/auth/pin/verify', { pin: pin.trim() });
      setShowPin(false);
      setPin('');
      await requestPayout(pendingMethod);
      setPendingMethod(null);
    } catch {
      setError(t('error.generic'));
    } finally {
      setRequesting(false);
    }
  }

  if (status === 'pending') {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
        <div className="h-64 animate-pulse rounded-xl bg-neutral-200" />
      </div>
    );
  }

  if (status === 'error' || !data) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{t('error.generic')}</div>
        <Link to="/home" className="mt-3 inline-block text-sm text-primary-600">← {t('android.nav.home', 'Home')}</Link>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 space-y-3 px-4 py-4">
      <h1 className="text-xl font-bold text-neutral-900">{t('creator.title', 'Creator Dashboard')}</h1>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <p className="text-xs font-medium uppercase text-neutral-500">{t('creator.revenueToday', 'Today')}</p>
          <p className="mt-1 text-lg font-bold text-neutral-900">{formatNgn(data.revenue.today)}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <p className="text-xs font-medium uppercase text-neutral-500">{t('creator.revenueWeek', 'This Week')}</p>
          <p className="mt-1 text-lg font-bold text-neutral-900">{formatNgn(data.revenue.week)}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <p className="text-xs font-medium uppercase text-neutral-500">{t('creator.revenueMonth', 'This Month')}</p>
          <p className="mt-1 text-lg font-bold text-neutral-900">{formatNgn(data.revenue.month)}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <p className="text-xs font-medium uppercase text-neutral-500">{t('creator.revenueAllTime', 'All Time')}</p>
          <p className="mt-1 text-lg font-bold text-neutral-900">{formatNgn(data.revenue.allTime)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card">
        <div className="border-b border-neutral-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700">{t('creator.revenueByStream', 'Revenue by Stream')}</h2>
        </div>
        <div className="divide-y divide-neutral-100">
          {Object.entries(data.revenue.byStream).filter(([, v]) => v > 0).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-neutral-700">{STREAM_LABEL[key] ?? key}</span>
              <span className="font-semibold text-neutral-900">{formatNgn(value)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-neutral-700">{t('creator.members', 'Members')}</h2>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-neutral-200 p-2.5">
            <p className="text-xs text-neutral-500">{t('creator.totalMembers', 'Total Members')}</p>
            <p className="text-lg font-bold text-neutral-900">{data.members.total.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-neutral-200 p-2.5">
            <p className="text-xs text-neutral-500">{t('creator.active30d', 'Active (7d)')}</p>
            <p className="text-lg font-bold text-teal-600">{data.members.active.toLocaleString()}</p>
          </div>
        </div>

        {data.topGifters.length > 0 && (
          <>
            <p className="mb-2 mt-4 text-xs font-semibold uppercase text-neutral-500">{t('creator.topGifters', 'Top Gifters')}</p>
            <div className="space-y-1.5">
              {data.topGifters.map((g, i) => (
                <Link key={g.user_id} to="/profile/$username" params={{ username: g.username }} className="flex items-center gap-2.5 rounded-lg border border-neutral-100 p-2">
                  <span className="w-4 text-center text-xs font-bold text-neutral-400">#{i + 1}</span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 text-lg">{g.avatar_emoji}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">@{g.username}</span>
                  <span className="text-sm font-bold text-amber-600">{g.total_coins.toLocaleString()} 🪙</span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card">
        <div className="border-b border-neutral-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700">{t('creator.payouts', 'Payouts')}</h2>
        </div>
        <div className="p-4">
          {payoutsStatus === 'pending' ? (
            <div className="h-16 animate-pulse rounded-lg bg-neutral-100" />
          ) : payouts ? (
            <>
              <div className="mb-3 flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50 p-3">
                <div>
                  <p className="text-xs text-teal-700">{t('creator.availableBalance', 'Available Balance')}</p>
                  <p className="text-xl font-bold text-teal-700">{formatNgn(payouts.availableEarningsKobo)}</p>
                </div>
                {!payouts.pendingPayout && payouts.payoutConfig && (
                  <div className="flex gap-1.5">
                    {payouts.payoutConfig.coinsEnabled && (
                      <button onClick={() => requestPayout('coins')} disabled={requesting} className="rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">
                        {t('creator.requestPayout', 'Request')} (🪙)
                      </button>
                    )}
                    {payouts.payoutConfig.bankTransferEnabled && (
                      <button onClick={() => requestPayout('bank_transfer')} disabled={requesting} className="rounded-lg border border-teal-600 px-3 py-2 text-xs font-semibold text-teal-700 disabled:opacity-60">
                        {t('creator.requestPayout', 'Request')} (Bank)
                      </button>
                    )}
                  </div>
                )}
              </div>
              {payouts.pendingPayout && (
                <p className="mb-3 text-xs text-neutral-500">{t('creator.requested', 'A payout is already in progress')} ({payouts.pendingPayout.method}).</p>
              )}
              {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
              {payouts.payouts.length > 0 && (
                <div className="space-y-2">
                  {payouts.payouts.slice(0, 10).map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-sm">
                      <div>
                        <p className="font-medium text-neutral-900">{formatNgn(p.netKobo)}</p>
                        <p className="text-xs text-neutral-400">{new Date(p.createdAt).toLocaleDateString()}</p>
                      </div>
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold capitalize text-neutral-600">{p.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>

      {showPin && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setShowPin(false)} />
          <div className="fixed left-4 right-4 top-1/2 z-50 -translate-y-1/2 rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="mb-3 text-base font-bold text-neutral-900">{t('android.pin.title')}</h3>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className="w-full rounded-xl border border-neutral-200 px-4 py-3 text-center text-xl tracking-widest focus:border-primary-500 focus:outline-none"
              autoFocus
            />
            <div className="mt-4 flex gap-3">
              <button onClick={() => setShowPin(false)} className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700">
                {t('gifts.send.cancel')}
              </button>
              <button onClick={handlePinVerify} disabled={requesting || pin.length < 4} className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/creator/')({
  component: CreatorDashboardPage,
});
