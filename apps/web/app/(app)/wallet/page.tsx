"use client";

/**
 * app/(app)/wallet/page.tsx
 *
 * Coin Store / Wallet page.
 * - Coin & star balance
 * - Transaction history (last 20)
 * - Coin packs for purchase (Paystack checkout)
 * - Active booster packs & subscription plan info
 */

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Balance {
  coins: number;
  stars: number;
  plan?: string;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  description: string;
  createdAt: string;
}

interface CoinPack {
  id: string;
  name: string;
  coins: number;
  price: number;
  currency: string;
  badge?: string;
}

interface BoosterPack {
  id: string;
  name: string;
  description: string;
  expiresAt: string;
}

interface StoreData {
  balance: Balance | null;
  transactions: Transaction[];
  coinPacks: CoinPack[];
  boosters: BoosterPack[];
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 dark:bg-neutral-700 ${className}`} />;
}

function WalletSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <SkeletonBlock className="h-24 rounded-xl" />
        <SkeletonBlock className="h-24 rounded-xl" />
      </div>
      <SkeletonBlock className="h-48 rounded-xl" />
      <SkeletonBlock className="h-64 rounded-xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Balance Cards
// ---------------------------------------------------------------------------

function BalanceCard({ balance }: { balance: Balance }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Coin Balance</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-2xl">🪙</span>
          <span className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
            {balance.coins.toLocaleString()}
          </span>
        </div>
      </div>
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Star Balance</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-2xl">⭐</span>
          <span className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
            {balance.stars.toLocaleString()}
          </span>
        </div>
        {balance.plan && (
          <p className="mt-1 text-xs text-neutral-400">Plan: {balance.plan}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coin Packs
// ---------------------------------------------------------------------------

interface CoinPacksProps {
  packs: CoinPack[];
  onPurchase: (packId: string) => Promise<void>;
  purchasing: string | null;
}

function CoinPacks({ packs, onPurchase, purchasing }: CoinPacksProps) {
  if (packs.length === 0) return null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Buy Coins</h2>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {packs.map((pack) => (
          <div
            key={pack.id}
            className="flex flex-col rounded-xl border border-neutral-200 p-4 dark:border-neutral-700"
          >
            {pack.badge && (
              <span className="mb-2 self-start rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                {pack.badge}
              </span>
            )}
            <div className="flex items-center gap-2">
              <span className="text-2xl">🪙</span>
              <span className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
                {pack.coins.toLocaleString()}
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold text-neutral-700 dark:text-neutral-300">{pack.name}</p>
            <button
              onClick={() => onPurchase(pack.id)}
              disabled={purchasing === pack.id}
              className="mt-3 rounded-xl bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {purchasing === pack.id
                ? "Processing…"
                : `${pack.currency} ${(pack.price / 100).toLocaleString()}`}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transaction History
// ---------------------------------------------------------------------------

function TransactionHistory({ transactions }: { transactions: Transaction[] }) {
  if (transactions.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Transaction History</h2>
        </div>
        <div className="px-5 py-8 text-center text-sm text-neutral-500">No transactions yet.</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Transaction History</h2>
      </div>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {transactions.map((tx) => (
          <div key={tx.id} className="flex items-center justify-between px-5 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{tx.description}</p>
              <p className="text-xs text-neutral-500">
                {new Date(tx.createdAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <span
              className={`ml-3 shrink-0 font-bold tabular-nums ${tx.amount >= 0 ? "text-teal-600" : "text-red-500"}`}
            >
              {tx.amount >= 0 ? "+" : ""}
              {tx.amount.toLocaleString()} 🪙
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Booster Packs
// ---------------------------------------------------------------------------

function BoosterPacks({ boosters }: { boosters: BoosterPack[] }) {
  if (boosters.length === 0) return null;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Active Boosters</h2>
      </div>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {boosters.map((b) => (
          <div key={b.id} className="flex items-start justify-between px-5 py-3">
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{b.name}</p>
              <p className="text-xs text-neutral-500">{b.description}</p>
            </div>
            <span className="ml-3 shrink-0 text-xs text-neutral-400">
              Expires{" "}
              {new Date(b.expiresAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function WalletPage() {
  const [data, setData] = useState<StoreData>({
    balance: null,
    transactions: [],
    coinPacks: [],
    boosters: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    (async () => {
      try {
        const [balRes, txRes, storeRes] = await Promise.all([
          fetch("/api/economy/coins/balance", { credentials: "include" }),
          fetch("/api/economy/coins/balance?history=1", { credentials: "include" }),
          fetch("/api/economy/store", { credentials: "include" }),
        ]);

        if (balRes.status === 401) { window.location.href = "/login"; return; }

        const balData = balRes.ok
          ? ((await balRes.json()) as { coins?: number; stars?: number; plan?: string })
          : null;

        // Some APIs may nest under 'data'
        const txData = txRes.ok
          ? ((await txRes.json()) as { transactions?: Transaction[]; data?: { transactions?: Transaction[] } })
          : null;
        const txList: Transaction[] =
          (txData as { transactions?: Transaction[] })?.transactions ??
          (txData as { data?: { transactions?: Transaction[] } })?.data?.transactions ??
          [];

        const storeData = storeRes.ok
          ? ((await storeRes.json()) as { items?: (CoinPack & { item_type?: string })[]; data?: (CoinPack & { item_type?: string })[] })
          : null;
        const allItems: (CoinPack & { item_type?: string })[] =
          (storeData as { items?: (CoinPack & { item_type?: string })[] })?.items ??
          (storeData as { data?: (CoinPack & { item_type?: string })[] })?.data ??
          [];
        const coinPacks = allItems.filter((i) => !i.item_type || i.item_type === "coin_pack");

        setData({
          balance: balData
            ? { coins: balData.coins ?? 0, stars: balData.stars ?? 0, plan: balData.plan }
            : null,
          transactions: txList.slice(0, 20),
          coinPacks,
          boosters: [],
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load wallet");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handlePurchase(packId: string) {
    setPurchasing(packId);
    try {
      const res = await fetch("/api/economy/coins/purchase", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId, provider: "paystack" }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { message?: string; error?: string };
        throw new Error(d.message ?? d.error ?? "Purchase failed");
      }
      const result = (await res.json()) as { checkoutUrl?: string; authorization_url?: string };
      const url = result.checkoutUrl ?? result.authorization_url;
      if (url) {
        window.location.href = url;
      } else {
        showToast("Purchase initiated — check your email for confirmation.");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Purchase failed");
    } finally {
      setPurchasing(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <WalletSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Wallet</h1>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-teal-600 px-4 py-3 text-sm font-medium text-white shadow-modal">
          {toast}
        </div>
      )}

      {data.balance && <BalanceCard balance={data.balance} />}

      <CoinPacks packs={data.coinPacks} onPurchase={handlePurchase} purchasing={purchasing} />

      <BoosterPacks boosters={data.boosters} />

      <TransactionHistory transactions={data.transactions} />
    </div>
  );
}
