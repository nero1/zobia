"use client";

/**
 * CoinStore
 *
 * Web coin store component. Displays coin packs, star packs, and booster items.
 * Initiates the payment flow by redirecting to the provider checkout URL.
 *
 * @module components/economy/CoinStore
 */

import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useCurrency } from "@/lib/hooks/useCurrency";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoinPack {
  id: string;
  name: string;
  description: string | null;
  priceKobo: number;
  currency: string;
  coinsGranted: number;
  bonusLabel: string | null;
  isFeatured: boolean;
}

interface StarPack {
  id: string;
  name: string;
  description: string | null;
  priceKobo: number;
  currency: string;
  starsGranted: number;
  bonusLabel: string | null;
  isFeatured: boolean;
}

interface BoosterItem {
  id: string;
  name: string;
  description: string | null;
  coinsCost: number;
  isFeatured: boolean;
}

interface StoreData {
  coinPacks: CoinPack[];
  starPacks: StarPack[];
  boosters: BoosterItem[];
  paymentEnabled: boolean;
  activeProvider: string;
}

interface PurchaseResult {
  paymentUrl: string;
  paymentReference: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchStore(): Promise<StoreData> {
  const res = await fetch("/api/economy/store", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load store");
  return res.json() as Promise<StoreData>;
}

async function initiatePurchase(packId: string): Promise<PurchaseResult> {
  const res = await fetch("/api/economy/coins/purchase", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ packId }),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? "Purchase failed");
  }
  return res.json() as Promise<PurchaseResult>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatKobo(kobo: number, currency = "NGN"): string {
  const amount = kobo / 100;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface PackCardProps {
  id: string;
  name: string;
  description: string | null;
  priceKobo: number;
  currency: string;
  grantedAmount: number;
  grantedLabel: string;
  grantedIcon: string;
  bonusLabel: string | null;
  isFeatured: boolean;
  isPurchasing: boolean;
  onPurchase: (id: string) => void;
}

function PackCard({
  id,
  name,
  description,
  priceKobo,
  currency,
  grantedAmount,
  grantedLabel,
  grantedIcon,
  bonusLabel,
  isFeatured,
  isPurchasing,
  onPurchase,
}: PackCardProps) {
  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-5 transition-shadow hover:shadow-md ${
        isFeatured
          ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30"
          : "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
      }`}
    >
      {isFeatured && (
        <span className="absolute -top-3 left-4 rounded-full bg-blue-600 px-3 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
          Best Value
        </span>
      )}

      {bonusLabel && (
        <span className="mb-2 self-start rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
          {bonusLabel}
        </span>
      )}

      <div className="mb-1 flex items-center gap-2">
        <span className="text-2xl" aria-hidden>
          {grantedIcon}
        </span>
        <span className="text-2xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
          {grantedAmount.toLocaleString()}
        </span>
        <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
          {grantedLabel}
        </span>
      </div>

      <p className="mb-1 text-base font-semibold text-neutral-800 dark:text-neutral-200">
        {name}
      </p>
      {description && (
        <p className="mb-3 text-sm text-neutral-500 dark:text-neutral-400">
          {description}
        </p>
      )}

      <div className="mt-auto">
        <p className="mb-3 text-xl font-bold text-neutral-900 dark:text-neutral-100">
          {formatKobo(priceKobo, currency)}
        </p>
        <button
          onClick={() => onPurchase(id)}
          disabled={isPurchasing}
          className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPurchasing ? "Processing..." : "Buy Now"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface CoinStoreProps {
  /** Optional className for the outer container. */
  className?: string;
}

/**
 * CoinStore — displays the full in-app store and handles purchase flow.
 *
 * @example
 * <CoinStore />
 */
export function CoinStore({ className = "" }: CoinStoreProps) {
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currency = useCurrency();

  const { data, isLoading, isError } = useQuery<StoreData>({
    queryKey: ["economy", "store"],
    queryFn: fetchStore,
    staleTime: 5 * 60_000, // 5 minutes
  });

  const purchaseMutation = useMutation<PurchaseResult, Error, string>({
    mutationFn: initiatePurchase,
    onMutate: (packId) => {
      setPurchasingId(packId);
      setError(null);
    },
    onSuccess: (result) => {
      // Redirect to payment provider checkout
      window.location.href = result.paymentUrl;
    },
    onError: (err) => {
      setError(err.message);
      setPurchasingId(null);
    },
  });

  if (isLoading) {
    return (
      <div className={`space-y-4 ${className}`}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-2xl bg-neutral-200 dark:bg-neutral-800"
          />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className={`rounded-2xl border border-red-200 bg-red-50 p-6 text-center ${className}`}>
        <p className="text-sm text-red-600">Failed to load store. Please try again.</p>
      </div>
    );
  }

  if (!data.paymentEnabled) {
    return (
      <div className={`rounded-2xl border border-neutral-200 bg-neutral-50 p-6 text-center ${className}`}>
        <p className="text-sm text-neutral-500">Payments are currently unavailable.</p>
      </div>
    );
  }

  return (
    <div className={`space-y-8 ${className}`}>
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Coin Packs */}
      {data.coinPacks.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            🪙 {currency.softPlural} Packs
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.coinPacks.map((pack) => (
              <PackCard
                key={pack.id}
                id={pack.id}
                name={pack.name}
                description={pack.description}
                priceKobo={pack.priceKobo}
                currency={pack.currency}
                grantedAmount={pack.coinsGranted}
                grantedLabel={currency.softPlural}
                grantedIcon="🪙"
                bonusLabel={pack.bonusLabel}
                isFeatured={pack.isFeatured}
                isPurchasing={purchasingId === pack.id}
                onPurchase={(id) => purchaseMutation.mutate(id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Star Packs */}
      {data.starPacks.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            ⭐ {currency.premiumPlural} Packs
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.starPacks.map((pack) => (
              <PackCard
                key={pack.id}
                id={pack.id}
                name={pack.name}
                description={pack.description}
                priceKobo={pack.priceKobo}
                currency={pack.currency}
                grantedAmount={pack.starsGranted}
                grantedLabel={currency.premiumPlural}
                grantedIcon="⭐"
                bonusLabel={pack.bonusLabel}
                isFeatured={pack.isFeatured}
                isPurchasing={purchasingId === pack.id}
                onPurchase={(id) => purchaseMutation.mutate(id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Booster Items */}
      {data.boosters.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            ⚡ Booster Packs
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {data.boosters.map((booster) => (
              <div
                key={booster.id}
                className="flex items-center justify-between rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900"
              >
                <div>
                  <p className="font-semibold text-neutral-900 dark:text-neutral-100">
                    {booster.name}
                  </p>
                  {booster.description && (
                    <p className="text-sm text-neutral-500 dark:text-neutral-400">
                      {booster.description}
                    </p>
                  )}
                  <p className="mt-1 text-sm font-medium text-amber-600 dark:text-amber-400">
                    🪙 {booster.coinsCost?.toLocaleString()} {currency.softPlural.toLowerCase()}
                  </p>
                </div>
                <button
                  className="rounded-xl border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/20"
                  onClick={() => {
                    // Booster purchase logic — TBD in a later sprint
                    setError("Booster purchase coming soon!");
                  }}
                >
                  Buy
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
