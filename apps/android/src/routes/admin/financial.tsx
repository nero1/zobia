/**
 * apps/android/src/routes/admin/financial.tsx
 *
 * Financial monitoring dashboard — mirrors apps/web/app/(admin)/admin/financial/page.tsx.
 * GET /admin/financial (flat JSON, no {success,data} envelope — mostly read-only; the
 * Creator Fund section below is the one mutation, POST /admin/creator-fund/topup).
 * All monetary values from the API are in kobo; divide by 100 before fmtCurrency.
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import {
  AdminStatCard,
  AdminStatSkeleton,
  AdminCard,
  AdminCardSkeleton,
  AdminErrorState,
  AdminSectionHeader,
  AdminToast,
  fmtNumber,
  fmtCurrency,
} from '@/components/admin/AdminUI';

interface CreatorFundData {
  balanceKobo: number;
  splits: Record<string, number>;
}

const CREATOR_FUND_ACTIVITY_LABELS: Record<string, string> = {
  room_subscription: 'Room Subscriptions',
  room_entry: 'Room Entry Fees',
  coin_purchase: 'Credit Pack Purchases',
  sponsor_budget: 'Branded Room Sponsorships',
  ad_reward: 'Rewarded Ad Payouts',
};

async function fetchCreatorFund(): Promise<CreatorFundData> {
  const { data } = await apiClient.get<CreatorFundData>('/admin/creator-fund');
  return data;
}

interface CoinEconomy {
  totalCoinsInCirculation: number;
  purchasedMonth: number;
  earnedMonth: number;
  burnedMonth: number;
  usersWithCoins: number;
}

interface ProviderRevenueRow {
  provider: string;
  revenueToday: number;
  revenueMonth: number;
  transactionCount: number;
}

interface PayoutSummary {
  awaitingApproval: { count: number; grossKobo: number };
  processing: { count: number; grossKobo: number };
  completedThisMonthNetKobo: number;
}

interface AnomalyAlert {
  level: 'info' | 'warning' | 'critical';
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

function koboToNgn(kobo: number): number {
  return kobo / 100;
}

async function fetchFinancial(): Promise<FinancialData> {
  const { data } = await apiClient.get<FinancialData>('/admin/financial');
  return data;
}

const ANOMALY_STYLE: Record<AnomalyAlert['level'], string> = {
  critical: 'border-danger-200 bg-danger-50 text-danger-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  info: 'border-blue-200 bg-blue-50 text-blue-800',
};
const ANOMALY_ICON: Record<AnomalyAlert['level'], string> = { critical: '🚨', warning: '⚠️', info: 'ℹ️' };

function EconomyBar({ economy, t }: { economy: CoinEconomy; t: (k: string, d: string) => string }) {
  const total = economy.purchasedMonth + economy.earnedMonth + economy.burnedMonth;
  const purchasedPct = total > 0 ? Math.round((economy.purchasedMonth / total) * 100) : 0;
  const earnedPct = total > 0 ? Math.round((economy.earnedMonth / total) * 100) : 0;
  const spentPct = total > 0 ? Math.max(0, 100 - purchasedPct - earnedPct) : 0;
  return (
    <AdminCard>
      <p className="mb-3 text-sm font-semibold text-neutral-700">{t('admin.financial.coinEconomy', 'Coin Economy (30-day)')}</p>
      <div className="mb-3 flex h-4 overflow-hidden rounded-full">
        <div className="bg-blue-500" style={{ width: `${purchasedPct}%` }} />
        <div className="bg-teal-500" style={{ width: `${earnedPct}%` }} />
        <div className="bg-amber-500" style={{ width: `${spentPct}%` }} />
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {[
          { color: 'bg-blue-500', label: t('admin.financial.purchased', 'Purchased'), pct: purchasedPct },
          { color: 'bg-teal-500', label: t('admin.financial.earned', 'Earned'), pct: earnedPct },
          { color: 'bg-amber-500', label: t('admin.financial.spent', 'Spent/Burned'), pct: spentPct },
        ].map(({ color, label, pct }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
            <span className="text-neutral-600">{label}</span>
            <span className="font-semibold text-neutral-900">{pct}%</span>
          </div>
        ))}
      </div>
    </AdminCard>
  );
}

function AdminFinancialPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, status, refetch } = useQuery({
    queryKey: ['admin', 'financial'],
    queryFn: fetchFinancial,
    staleTime: 30_000,
  });
  const { data: creatorFund } = useQuery({
    queryKey: ['admin', 'creator-fund'],
    queryFn: fetchCreatorFund,
    staleTime: 30_000,
  });
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpNote, setTopUpNote] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const topUpMutation = useMutation({
    mutationFn: async () => {
      const amountNgn = parseFloat(topUpAmount);
      if (!Number.isFinite(amountNgn) || amountNgn <= 0) throw new Error('Enter a valid amount');
      await apiClient.post('/admin/creator-fund/topup', {
        amountKobo: Math.round(amountNgn * 100),
        note: topUpNote || undefined,
      });
    },
    onSuccess: () => {
      setToast({ msg: t('admin.financial.creatorFundToppedUp', 'Creator Fund topped up'), type: 'success' });
      setTopUpAmount('');
      setTopUpNote('');
      void qc.invalidateQueries({ queryKey: ['admin', 'creator-fund'] });
    },
    onError: (e) => setToast({ msg: e instanceof Error ? e.message : 'Top-up failed', type: 'error' }),
  });

  return (
    <div className="px-4 py-5 space-y-5">
      <h1 className="text-xl font-bold text-neutral-900">{t('admin.nav.financial', 'Financial Monitoring')}</h1>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}

      {status !== 'error' && (
        <>
          {data && data.anomalyAlerts.length > 0 && (
            <div className="space-y-2">
              {data.anomalyAlerts.map((a) => (
                <div key={a.code} className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${ANOMALY_STYLE[a.level]}`}>
                  <span className="text-base">{ANOMALY_ICON[a.level]}</span>
                  <p>{a.message}</p>
                </div>
              ))}
            </div>
          )}

          <section>
            <div className="grid grid-cols-2 gap-2.5">
              {status === 'pending' ? (
                Array.from({ length: 4 }).map((_, i) => <AdminStatSkeleton key={i} />)
              ) : (
                <>
                  <AdminStatCard
                    label={t('admin.financial.coinsInCirculation', 'Coins in Circulation')}
                    value={fmtNumber(data?.coinEconomy.totalCoinsInCirculation ?? 0)}
                    color="gold"
                  />
                  <AdminStatCard
                    label={t('admin.financial.revenueMonth', 'Revenue This Month')}
                    value={fmtCurrency(koboToNgn(data?.revenueByProvider.reduce((sum, r) => sum + r.revenueMonth, 0) ?? 0))}
                    color="green"
                  />
                  <AdminStatCard
                    label={t('admin.financial.pendingPayouts', 'Pending Payout Approvals')}
                    value={String(data?.payoutSummary.awaitingApproval.count ?? 0)}
                    color="blue"
                  />
                  <AdminStatCard
                    label={t('admin.financial.usersWithCoins', 'Users With Coins')}
                    value={fmtNumber(data?.coinEconomy.usersWithCoins ?? 0)}
                    color="neutral"
                  />
                </>
              )}
            </div>
          </section>

          {status === 'pending' && <AdminCardSkeleton />}
          {data && <EconomyBar economy={data.coinEconomy} t={t} />}

          {data && (
            <section>
              <AdminSectionHeader>{t('admin.financial.payoutSummary', 'Payout Summary')}</AdminSectionHeader>
              <div className="grid grid-cols-1 gap-2.5">
                <AdminStatCard
                  label={t('admin.financial.awaitingApproval', 'Awaiting Approval')}
                  value={fmtCurrency(koboToNgn(data.payoutSummary.awaitingApproval.grossKobo))}
                  sub={t('admin.financial.payoutCount', '{{count}} payouts', { count: data.payoutSummary.awaitingApproval.count })}
                  color="gold"
                />
                <AdminStatCard
                  label={t('admin.financial.processing', 'Processing')}
                  value={fmtCurrency(koboToNgn(data.payoutSummary.processing.grossKobo))}
                  sub={t('admin.financial.payoutCount', '{{count}} payouts', { count: data.payoutSummary.processing.count })}
                  color="blue"
                />
                <AdminStatCard
                  label={t('admin.financial.completedMonth', 'Completed This Month')}
                  value={fmtCurrency(koboToNgn(data.payoutSummary.completedThisMonthNetKobo))}
                  color="green"
                />
              </div>
            </section>
          )}

          <section>
            <AdminSectionHeader>{t('admin.financial.creatorFund', 'Creator Fund')}</AdminSectionHeader>
            <AdminCard>
              <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                {t('admin.financial.currentPoolBalance', 'Current Pool Balance')}
              </p>
              <p className="text-xl font-bold text-teal-600">
                {creatorFund ? fmtCurrency(koboToNgn(creatorFund.balanceKobo)) : '—'}
              </p>
              {creatorFund && (
                <ul className="mt-2 space-y-0.5 text-xs text-neutral-500">
                  {Object.entries(creatorFund.splits).map(([activity, percent]) => (
                    <li key={activity}>{CREATOR_FUND_ACTIVITY_LABELS[activity] ?? activity}: {percent}%</li>
                  ))}
                </ul>
              )}
              <div className="mt-3 space-y-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={t('admin.financial.amountNgn', 'Amount (₦)')}
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  placeholder={t('admin.financial.noteOptional', 'Note (optional)')}
                  value={topUpNote}
                  onChange={(e) => setTopUpNote(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                />
                <button
                  onClick={() => topUpMutation.mutate()}
                  disabled={topUpMutation.isPending}
                  className="w-full rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {topUpMutation.isPending ? '…' : t('admin.financial.topUp', 'Top Up')}
                </button>
              </div>
            </AdminCard>
          </section>

          <section>
            <AdminSectionHeader>{t('admin.financial.revenueByProvider', 'Revenue by Provider')}</AdminSectionHeader>
            <div className="space-y-2.5">
              {status === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}
              {data?.revenueByProvider.map((r) => (
                <AdminCard key={r.provider}>
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-neutral-900">{r.provider}</p>
                    <p className="text-xs text-neutral-500">{fmtNumber(r.transactionCount)} {t('admin.financial.transactions', 'transactions')}</p>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-neutral-500">{t('admin.financial.today', 'Today')}: <span className="font-medium text-neutral-800">{fmtCurrency(koboToNgn(r.revenueToday))}</span></span>
                    <span className="text-neutral-500">{t('admin.financial.thisMonth', 'This Month')}: <span className="font-semibold text-teal-700">{fmtCurrency(koboToNgn(r.revenueMonth))}</span></span>
                  </div>
                </AdminCard>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/financial')({
  component: AdminFinancialPage,
});
