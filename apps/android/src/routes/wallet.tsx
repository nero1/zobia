/**
 * apps/android/src/routes/wallet.tsx
 *
 * Wallet screen — mirrors the web/PWA wallet page (apps/web/app/(app)/wallet/page.tsx)
 * as closely as possible: balance (XP/Credits/Stars), a rank/badges summary linking
 * to the full Stats screen, and paginated transaction history (10 per page, coins/
 * stars tabs, "Load more").
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';
import { COIN_PRODUCTS, STAR_PRODUCTS, purchaseCoins, purchaseStars } from '@/lib/payments/googlePlay';
import RewardedAdButton from '@/components/ads/RewardedAdButton';
import { useFeatureFlags, useFeatureModVisibility, resolveFeatureAccess } from '@/lib/hooks/useManifest';
import { useAuth } from '@/lib/auth/store';
import { useFiatCurrency, formatKoboClient, type FiatCurrency } from '@/lib/hooks/useFiatCurrency';
import { CryptoBalancesSection } from '@/components/wallet/CryptoBalancesSection';

const TX_PAGE_SIZE = 10;

interface MeSummary {
  id: string;
  coin_balance: number;
  star_balance: number;
  xp_total: number;
  plan: string;
  rank_name: string;
  rank_sublevel: number;
  prestige_count: number;
  badge_count: number;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  description: string | null;
  createdAt: string;
}

interface BalancePage {
  transactions: Transaction[];
  starTransactions: Transaction[];
  nextCursor: string | null;
  nextStarCursor: string | null;
}

async function fetchMe() {
  const { data } = await apiClient.get<{ user: MeSummary }>('/users/me');
  return data.user;
}

async function fetchTransactions({ pageParam, tab }: { pageParam?: string; tab: 'coins' | 'stars' }): Promise<BalancePage> {
  const params = new URLSearchParams({ limit: String(TX_PAGE_SIZE) });
  if (pageParam) params.set(tab === 'coins' ? 'cursor' : 'star_cursor', pageParam);
  const { data } = await apiClient.get<BalancePage>(`/economy/coins/balance?${params.toString()}`);
  return data;
}

/**
 * Shrinks the number's font size as its digit count grows so that even a
 * 15-digit balance stays on one line inside its box instead of overflowing
 * into (and being visually clipped by) the next box. Mirrors
 * apps/web/app/(app)/wallet/page.tsx's `balanceFontSizeClass`.
 */
function balanceFontSizeClass(value: number): string {
  const digits = Math.abs(Math.trunc(value)).toString().length;
  if (digits > 12) return 'text-xs';
  if (digits > 9) return 'text-sm';
  if (digits > 6) return 'text-base';
  return 'text-lg';
}

function BalanceBox({ label, value }: { label: string; value: string | number }) {
  const formatted = typeof value === 'number' ? value.toLocaleString() : value;
  return (
    <div className="min-w-[7rem] flex-1 basis-[7rem] bg-white dark:bg-neutral-800 rounded-xl p-3 text-center">
      <p
        className={`font-bold tabular-nums text-neutral-900 dark:text-neutral-100 ${typeof value === 'number' ? balanceFontSizeClass(value) : 'text-lg'}`}
        title={formatted}
      >
        {formatted}
      </p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
    </div>
  );
}

interface CreatorPayoutsSummary {
  isCreator?: boolean;
  availableEarningsKobo: number;
  minPayoutKobo: number;
  payoutConfig: unknown | null;
}

/**
 * Compact creator-earnings card for the wallet screen — mirrors
 * apps/web/app/(app)/wallet/page.tsx's `EarningsSection`. Only rendered for
 * creators (payoutConfig is non-null only when `is_creator = true` — see
 * GET /api/creator/payouts). Links to the full /creator dashboard to withdraw.
 */
function CreatorEarningsCard({ payouts, fiat }: { payouts: CreatorPayoutsSummary; fiat: FiatCurrency }) {
  const { t } = useTranslation();
  const met = payouts.availableEarningsKobo >= payouts.minPayoutKobo;
  const pct = payouts.minPayoutKobo > 0
    ? Math.min(100, Math.round((payouts.availableEarningsKobo / payouts.minPayoutKobo) * 100))
    : 100;
  const remaining = Math.max(0, payouts.minPayoutKobo - payouts.availableEarningsKobo);
  const fmt = (kobo: number) => formatKoboClient(kobo, fiat);

  return (
    <div className="mx-6 mb-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          {t('creator.availableBalance', 'Available Balance')}
        </p>
        <Link to="/creator" className="text-xs font-semibold text-blue-600 dark:text-blue-300">
          {t('creator.manageAndWithdraw', 'Manage & Withdraw →')}
        </Link>
      </div>
      <p className="mt-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">{fmt(payouts.availableEarningsKobo)}</p>
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs">
          <span className={`font-semibold ${met ? 'text-teal-700 dark:text-teal-300' : 'text-amber-700 dark:text-amber-300'}`}>
            {met ? t('creator.thresholdMet', '✅ Withdrawal threshold reached') : `${fmt(remaining)} ${t('creator.thresholdRemaining', 'more to reach the minimum payout')}`}
          </span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full transition-all duration-500 ${met ? 'bg-teal-500' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

function RankBadgesSummary({ me }: { me: MeSummary }) {
  const { t } = useTranslation();
  const subLabel = `${me.rank_name} ${['I', 'II', 'III'][me.rank_sublevel - 1] ?? 'I'}`;
  return (
    <Link to="/stats" className="flex items-center justify-between gap-3 bg-white dark:bg-neutral-800 px-6 py-4 mb-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="rounded-full bg-primary-600 px-2.5 py-1 text-xs font-bold text-white">{subLabel}</span>
        {me.prestige_count > 0 && (
          <span className="text-amber-500 text-sm">{'★'.repeat(Math.min(me.prestige_count, 5))}</span>
        )}
        <span className="text-sm text-neutral-500 dark:text-neutral-400">🏆 {t('profile.stats.badgeCount', { count: me.badge_count })}</span>
      </div>
      <span className="shrink-0 text-xs font-semibold text-primary-600 dark:text-primary-300">{t('wallet.viewFullStats')}</span>
    </Link>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-100 dark:border-neutral-800 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 capitalize truncate">{tx.description ?? tx.type.replace(/_/g, ' ')}</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{new Date(tx.createdAt).toLocaleDateString()}</p>
      </div>
      <span className={`ml-3 shrink-0 font-bold text-sm ${tx.amount >= 0 ? 'text-success-600 dark:text-success-300' : 'text-danger-500'}`}>
        {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString()}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buy Coins / Buy Stars — Google Play Billing only (PRD §18; web/PWA use
// Paystack/crypto via POST /api/economy/coins/purchase instead).
// ---------------------------------------------------------------------------

function BuyCurrencyPanel({ onPurchased }: { onPurchased: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'coins' | 'stars'>('coins');
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleBuy(productId: string) {
    setError(null);
    setPurchasingId(productId);
    try {
      const result = tab === 'coins' ? await purchaseCoins(productId) : await purchaseStars(productId);
      if (result.success) {
        onPurchased();
      } else if (result.error) {
        setError(result.error);
      }
    } finally {
      setPurchasingId(null);
    }
  }

  const products = tab === 'coins' ? COIN_PRODUCTS : STAR_PRODUCTS;

  return (
    <div className="bg-white dark:bg-neutral-800 mb-3">
      <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-100 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t('wallet.buyCurrency', 'Buy Credits & Stars')}</h2>
        <div className="flex gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 p-0.5">
          <button
            onClick={() => setTab('coins')}
            className={`rounded-md px-3 py-1 text-xs font-semibold ${tab === 'coins' ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}
          >
            {t('wallet.coinsBalance')}
          </button>
          <button
            onClick={() => setTab('stars')}
            className={`rounded-md px-3 py-1 text-xs font-semibold ${tab === 'stars' ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}
          >
            {t('wallet.starsBalance')}
          </button>
        </div>
      </div>

      {error && <p className="px-6 pt-3 text-xs text-red-600 dark:text-red-300">{error}</p>}

      <div className="grid grid-cols-2 gap-2 p-4">
        {products.map((p) => (
          <button
            key={p.id}
            onClick={() => handleBuy(p.id)}
            disabled={purchasingId !== null}
            className="rounded-xl border border-neutral-200 dark:border-neutral-700 p-3 text-left disabled:opacity-60"
          >
            <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
              {tab === 'coins' ? `🪙 ${(p as (typeof COIN_PRODUCTS)[number]).coins.toLocaleString()}` : `⭐ ${(p as (typeof STAR_PRODUCTS)[number]).stars.toLocaleString()}`}
            </p>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              {purchasingId === p.id ? t('common.loading', 'Loading…') : p.price}
            </p>
          </button>
        ))}
      </div>
      <p className="px-6 pb-4 text-xs text-neutral-400 dark:text-neutral-500">{t('business.intro.playBilling', 'Payment is handled securely by Google Play.')}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Booster Packs — mirrors apps/web/app/(app)/wallet/page.tsx's
// `<BoosterPacks>` section. Boosts are spent from existing Credits (see
// GET/POST /api/economy/boosters — `coins_cost`), not a real-money purchase,
// so this goes through the platform-agnostic API directly rather than
// Google Play Billing (which has no boost product family — see
// lib/payments/googlePlay.ts).
// ---------------------------------------------------------------------------

interface BoostType {
  id: string;
  key: string;
  label: string;
  description: string | null;
  duration_hours: number;
  coins_cost: number | null;
  stackable: boolean;
}

interface ActiveBooster {
  id: string;
  booster_type: string;
  expires_at: string;
  label: string | null;
  description: string | null;
}

interface BoostersData {
  boosts: BoostType[];
  activeBoosters: ActiveBooster[];
}

async function fetchBoosters(): Promise<BoostersData> {
  const { data } = await apiClient.get<BoostersData>('/economy/boosters');
  return data;
}

function boosterCountdown(expiresAt: string): string {
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  if (msLeft <= 0) return '';
  const h = Math.floor(msLeft / 3_600_000);
  const m = Math.floor((msLeft % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function BoosterPacksPanel({ onPurchased }: { onPurchased: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const { data, status } = useQuery({ queryKey: ['wallet', 'boosters'], queryFn: fetchBoosters });

  const purchaseMutation = useMutation({
    mutationFn: (boosterType: string) => apiClient.post('/economy/boosters', { boosterType }),
    onSuccess: () => { setError(null); onPurchased(); },
    onError: (err: unknown) => {
      const e = err as AxiosError<{ error?: { message?: string } }>;
      setError(e.response?.data?.error?.message ?? t('wallet.boosters.purchaseFailed', 'Failed to purchase booster'));
    },
  });

  if (status === 'pending' || !data || (data.boosts.length === 0 && data.activeBoosters.length === 0)) return null;

  const activeTypes = new Set(data.activeBoosters.map((b) => b.booster_type));

  return (
    <div className="bg-white dark:bg-neutral-800 mb-3">
      <div className="px-6 py-3 border-b border-neutral-100 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t('wallet.boosters.title', 'Boosts & Passes')}</h2>
      </div>

      {data.activeBoosters.length > 0 && (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-700 border-b border-neutral-100 dark:border-neutral-800">
          {data.activeBoosters.map((b) => (
            <div key={b.id} className="flex items-start justify-between px-6 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{b.label ?? b.booster_type}</p>
                {b.description && <p className="text-xs text-neutral-500 dark:text-neutral-400">{b.description}</p>}
              </div>
              <span className="ml-3 shrink-0 text-xs font-semibold tabular-nums text-teal-600 dark:text-teal-300">
                {boosterCountdown(b.expires_at)} {t('wallet.boosters.left', 'left')}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && <p className="px-6 pt-3 text-xs text-red-600 dark:text-red-300">{error}</p>}

      {data.boosts.length > 0 && (
        <div className="grid grid-cols-2 gap-2 p-4">
          {data.boosts.map((b) => {
            const alreadyActive = !b.stackable && activeTypes.has(b.key);
            return (
              <button
                key={b.id}
                onClick={() => purchaseMutation.mutate(b.key)}
                disabled={purchaseMutation.isPending || alreadyActive}
                className="rounded-xl border border-neutral-200 dark:border-neutral-700 p-3 text-left disabled:opacity-60"
              >
                <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100">{b.label}</p>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{b.description}</p>
                <p className="mt-1 text-xs font-semibold text-amber-600 dark:text-amber-300">
                  {alreadyActive
                    ? t('wallet.boosters.active', 'Active')
                    : purchaseMutation.isPending && purchaseMutation.variables === b.key
                      ? t('common.loading', 'Loading…')
                      : `🪙 ${(b.coins_cost ?? 0).toLocaleString()}`}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WalletPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [tab, setTab] = useState<'coins' | 'stars'>('coins');
  const featureFlags = useFeatureFlags();
  const modVisibleKeys = useFeatureModVisibility();
  const statsAccess = resolveFeatureAccess(
    featureFlags?.profileStats !== false,
    modVisibleKeys.includes('profileStats'),
    { isAdmin: user?.is_admin, isModerator: user?.is_moderator }
  );

  const { data: me, status: meStatus } = useQuery({ queryKey: ['users', 'me'], queryFn: fetchMe });
  const { data: fiat = { currency: 'USD' as const, isNigeria: false, usdToNgnRate: '1600' } } = useFiatCurrency();

  // Creator earnings card — silently absent for non-creators (payoutConfig is null).
  const { data: payouts } = useQuery({
    queryKey: ['creator', 'payouts'],
    queryFn: async () => (await apiClient.get<CreatorPayoutsSummary>('/creator/payouts')).data,
  });

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status } = useInfiniteQuery({
    queryKey: ['wallet', 'transactions', tab],
    queryFn: ({ pageParam }) => fetchTransactions({ pageParam, tab }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (tab === 'coins' ? lastPage.nextCursor : lastPage.nextStarCursor) ?? undefined,
  });

  const list =
    tab === 'coins'
      ? (data?.pages.flatMap((p) => p.transactions) ?? [])
      : (data?.pages.flatMap((p) => p.starTransactions) ?? []);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-800">
      <div className="px-6 pt-4 pb-2">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{t('wallet.title')}</h1>
      </div>

      {/*
       * Flex-wrap (not a fixed 3-col grid) so a box holding a very long
       * number can grow to fit its content and, if there isn't room for all
       * three on one row, the next box gracefully wraps to a new line
       * instead of overflowing and getting painted over by its neighbour.
       */}
      <div className="flex flex-wrap gap-2 px-6 mb-3">
        <BalanceBox label="XP" value={meStatus === 'success' ? me.xp_total : '—'} />
        <BalanceBox label={t('wallet.coinsBalance')} value={meStatus === 'success' ? me.coin_balance : '—'} />
        <BalanceBox label={t('wallet.starsBalance')} value={meStatus === 'success' ? me.star_balance : '—'} />
      </div>

      {meStatus === 'success' && statsAccess.accessible && <RankBadgesSummary me={me} />}

      {payouts?.payoutConfig != null && <CreatorEarningsCard payouts={payouts} fiat={fiat} />}

      <div className="mx-6 mb-3">
        <CryptoBalancesSection />
      </div>

      {meStatus === 'success' && (me.plan === 'free' || me.plan === 'plus') && (
        <div className="px-6 mb-3">
          <RewardedAdButton
            onRewarded={() => qc.invalidateQueries({ queryKey: ['users', 'me'] })}
          />
        </div>
      )}

      <BuyCurrencyPanel
        onPurchased={() => {
          qc.invalidateQueries({ queryKey: ['users', 'me'] });
          // ZSB-12 fix: this only refreshed the balance cards — the
          // transaction-history infinite query wasn't invalidated, so a
          // just-completed Google Play purchase didn't show up in the list
          // until something else happened to refetch it.
          qc.invalidateQueries({ queryKey: ['wallet', 'transactions'] });
        }}
      />

      <BoosterPacksPanel
        onPurchased={() => {
          qc.invalidateQueries({ queryKey: ['users', 'me'] });
          qc.invalidateQueries({ queryKey: ['wallet', 'boosters'] });
          qc.invalidateQueries({ queryKey: ['wallet', 'transactions'] });
        }}
      />

      {/* Transaction history */}
      <div className="bg-white dark:bg-neutral-800 mb-3">
        <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-100 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t('wallet.transactionHistory')}</h2>
          <div className="flex gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 p-0.5">
            <button
              onClick={() => setTab('coins')}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${tab === 'coins' ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}
            >
              {t('wallet.coinTransactions')}
            </button>
            <button
              onClick={() => setTab('stars')}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${tab === 'stars' ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'}`}
            >
              {t('wallet.starTransactions')}
            </button>
          </div>
        </div>

        {status === 'pending' ? (
          <div className="px-6 py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">…</div>
        ) : list.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
            {tab === 'coins' ? t('wallet.noCoinTransactions') : t('wallet.noStarTransactions')}
          </div>
        ) : (
          list.map((tx) => <TxRow key={tx.id} tx={tx} />)
        )}

        {hasNextPage && (
          <div className="flex justify-center py-3">
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="rounded-xl border border-neutral-300 dark:border-neutral-600 px-5 py-2 text-xs font-semibold text-neutral-700 dark:text-neutral-300 disabled:opacity-60"
            >
              {isFetchingNextPage ? t('wallet.loadingMore') : t('wallet.loadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/wallet')({
  component: WalletPage,
});
