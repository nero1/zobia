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
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { COIN_PRODUCTS, STAR_PRODUCTS, purchaseCoins, purchaseStars } from '@/lib/payments/googlePlay';

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

function RankBadgesSummary({ me }: { me: MeSummary }) {
  const { t } = useTranslation();
  const subLabel = `${me.rank_name} ${['I', 'II', 'III'][me.rank_sublevel - 1] ?? 'I'}`;
  return (
    <Link to="/stats" className="flex items-center justify-between gap-3 bg-white px-6 py-4 mb-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="rounded-full bg-primary-600 px-2.5 py-1 text-xs font-bold text-white">{subLabel}</span>
        {me.prestige_count > 0 && (
          <span className="text-amber-500 text-sm">{'★'.repeat(Math.min(me.prestige_count, 5))}</span>
        )}
        <span className="text-sm text-neutral-500">🏆 {t('profile.stats.badgeCount', { count: me.badge_count })}</span>
      </div>
      <span className="shrink-0 text-xs font-semibold text-primary-600">{t('wallet.viewFullStats')}</span>
    </Link>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-100 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-900 capitalize truncate">{tx.description ?? tx.type.replace(/_/g, ' ')}</p>
        <p className="text-xs text-neutral-500">{new Date(tx.createdAt).toLocaleDateString()}</p>
      </div>
      <span className={`ml-3 shrink-0 font-bold text-sm ${tx.amount >= 0 ? 'text-success-600' : 'text-danger-500'}`}>
        {tx.amount >= 0 ? '+' : ''}{tx.amount.toLocaleString()}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buy Coins / Buy Stars — Google Play Billing only (PRD §18; web/PWA use
// Paystack/DodoPayments via POST /api/economy/coins/purchase instead).
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
    <div className="bg-white mb-3">
      <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-100">
        <h2 className="text-sm font-semibold text-neutral-700">{t('wallet.buyCurrency', 'Buy Credits & Stars')}</h2>
        <div className="flex gap-1 rounded-lg bg-neutral-100 p-0.5">
          <button
            onClick={() => setTab('coins')}
            className={`rounded-md px-3 py-1 text-xs font-semibold ${tab === 'coins' ? 'bg-white text-neutral-900' : 'text-neutral-500'}`}
          >
            {t('wallet.coinsBalance')}
          </button>
          <button
            onClick={() => setTab('stars')}
            className={`rounded-md px-3 py-1 text-xs font-semibold ${tab === 'stars' ? 'bg-white text-neutral-900' : 'text-neutral-500'}`}
          >
            {t('wallet.starsBalance')}
          </button>
        </div>
      </div>

      {error && <p className="px-6 pt-3 text-xs text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-2 p-4">
        {products.map((p) => (
          <button
            key={p.id}
            onClick={() => handleBuy(p.id)}
            disabled={purchasingId !== null}
            className="rounded-xl border border-neutral-200 p-3 text-left disabled:opacity-60"
          >
            <p className="text-sm font-bold text-neutral-900">
              {tab === 'coins' ? `🪙 ${(p as (typeof COIN_PRODUCTS)[number]).coins.toLocaleString()}` : `⭐ ${(p as (typeof STAR_PRODUCTS)[number]).stars.toLocaleString()}`}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {purchasingId === p.id ? t('common.loading', 'Loading…') : p.price}
            </p>
          </button>
        ))}
      </div>
      <p className="px-6 pb-4 text-xs text-neutral-400">{t('business.intro.playBilling', 'Payment is handled securely by Google Play.')}</p>
    </div>
  );
}

function WalletPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'coins' | 'stars'>('coins');

  const { data: me, status: meStatus } = useQuery({ queryKey: ['users', 'me'], queryFn: fetchMe });

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
    <div className="h-full overflow-y-auto bg-neutral-50">
      <div className="px-6 pt-4 pb-2">
        <h1 className="text-xl font-bold text-neutral-900">{t('wallet.title')}</h1>
      </div>

      {/* Balance */}
      <div className="grid grid-cols-3 gap-2 px-6 mb-3">
        <div className="bg-white rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-neutral-900">{meStatus === 'success' ? me.xp_total.toLocaleString() : '—'}</p>
          <p className="text-xs text-neutral-500">XP</p>
        </div>
        <div className="bg-white rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-neutral-900">{meStatus === 'success' ? me.coin_balance.toLocaleString() : '—'}</p>
          <p className="text-xs text-neutral-500">{t('wallet.coinsBalance')}</p>
        </div>
        <div className="bg-white rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-neutral-900">{meStatus === 'success' ? me.star_balance.toLocaleString() : '—'}</p>
          <p className="text-xs text-neutral-500">{t('wallet.starsBalance')}</p>
        </div>
      </div>

      {meStatus === 'success' && <RankBadgesSummary me={me} />}

      <BuyCurrencyPanel onPurchased={() => qc.invalidateQueries({ queryKey: ['users', 'me'] })} />

      {/* Transaction history */}
      <div className="bg-white mb-3">
        <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-100">
          <h2 className="text-sm font-semibold text-neutral-700">{t('wallet.transactionHistory')}</h2>
          <div className="flex gap-1 rounded-lg bg-neutral-100 p-0.5">
            <button
              onClick={() => setTab('coins')}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${tab === 'coins' ? 'bg-white text-neutral-900' : 'text-neutral-500'}`}
            >
              {t('wallet.coinTransactions')}
            </button>
            <button
              onClick={() => setTab('stars')}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${tab === 'stars' ? 'bg-white text-neutral-900' : 'text-neutral-500'}`}
            >
              {t('wallet.starTransactions')}
            </button>
          </div>
        </div>

        {status === 'pending' ? (
          <div className="px-6 py-8 text-center text-sm text-neutral-400">…</div>
        ) : list.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-neutral-500">
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
              className="rounded-xl border border-neutral-300 px-5 py-2 text-xs font-semibold text-neutral-700 disabled:opacity-60"
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
