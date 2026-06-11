"use client";

/**
 * WalletCard
 *
 * Web wallet balance display card.
 *
 * Shows the user's current coin and star balances prominently,
 * with a link to the full transaction history and a top-up CTA.
 *
 * @module components/economy/WalletCard
 */

import React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useCurrency } from "@/lib/hooks/useCurrency";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WalletBalance {
  coins: number;
  stars: number;
}

interface WalletCardProps {
  /** Pre-loaded balance; if omitted, fetches from the API. */
  initialData?: WalletBalance;
  /** Whether to show the "Add Coins" CTA button. Default: true. */
  showTopUp?: boolean;
  /** Optional className for the outer container. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchBalance(): Promise<WalletBalance> {
  const res = await fetch("/api/economy/coins/balance", {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to load balance");
  return res.json() as Promise<WalletBalance>;
}

function formatCoins(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toLocaleString();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * WalletCard — displays coin and star balances with a top-up CTA.
 *
 * @example
 * <WalletCard showTopUp />
 */
export function WalletCard({
  initialData,
  showTopUp = true,
  className = "",
}: WalletCardProps) {
  const currency = useCurrency();
  const { data, isLoading, isError } = useQuery<WalletBalance>({
    queryKey: ["wallet", "balance"],
    queryFn: fetchBalance,
    initialData,
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: true,
  });

  return (
    <div
      className={`rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 ${className}`}
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          My Wallet
        </h2>
        <Link
          href="/economy/wallet"
          className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
        >
          View history
        </Link>
      </div>

      {/* Balances */}
      {isLoading ? (
        <div className="flex gap-8">
          <BalanceSkeleton />
          <BalanceSkeleton />
        </div>
      ) : isError ? (
        <p className="text-sm text-red-500">Failed to load balance</p>
      ) : (
        <div className="flex gap-8">
          {/* Coins */}
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xl" aria-hidden>
                🪙
              </span>
              <span className="text-3xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
                {formatCoins(data?.coins ?? 0)}
              </span>
            </div>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {currency.softPlural}
            </p>
          </div>

          <div className="w-px bg-neutral-200 dark:bg-neutral-700" />

          {/* Premium currency */}
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xl" aria-hidden>
                ⭐
              </span>
              <span className="text-3xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
                {data?.stars ?? 0}
              </span>
            </div>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {currency.premiumPlural}
            </p>
          </div>
        </div>
      )}

      {/* Top-up CTA */}
      {showTopUp && (
        <Link
          href="/economy/store"
          className="mt-5 flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 active:bg-blue-800"
        >
          🪙 Add {currency.softPlural}
        </Link>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: skeleton loader
// ---------------------------------------------------------------------------

function BalanceSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-8 w-24 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-3 w-12 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}
