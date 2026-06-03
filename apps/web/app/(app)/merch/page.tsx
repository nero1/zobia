"use client";

/**
 * app/(app)/merch/page.tsx
 *
 * Merch directory — grid of all active creator merch stores.
 * Links to /merch/[creatorId] for individual stores.
 */

import { useState, useEffect } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MerchStore {
  creatorId: string;
  storeName: string;
  description: string | null;
  creatorUsername: string;
  creatorAvatarEmoji: string;
  productCount: number;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function StoreSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-center gap-3">
        <div className="h-12 w-12 rounded-full bg-neutral-200 dark:bg-neutral-700" />
        <div>
          <div className="mb-1 h-4 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-3 w-20 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      </div>
      <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Store card
// ---------------------------------------------------------------------------

function StoreCard({ store }: { store: MerchStore }) {
  return (
    <Link
      href={`/merch/${store.creatorId}`}
      className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition-all hover:border-blue-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-blue-700"
    >
      {/* Creator info */}
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-2xl dark:bg-neutral-800">
          {store.creatorAvatarEmoji}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-neutral-900 dark:text-neutral-100">{store.storeName}</p>
          <p className="truncate text-xs text-neutral-500">@{store.creatorUsername}</p>
        </div>
      </div>

      {/* Description */}
      {store.description && (
        <p className="mb-3 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-400">{store.description}</p>
      )}

      {/* Product count */}
      <div className="mt-auto flex items-center justify-between">
        <span className="text-xs text-neutral-500">{store.productCount} product{store.productCount !== 1 ? "s" : ""}</span>
        <span className="flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400">
          View Store
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Merch directory — browse all active creator stores.
 */
export default function MerchDirectoryPage() {
  const [stores, setStores] = useState<MerchStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/merch/stores", { credentials: "include" });
        if (res.status === 401) { window.location.href = "/login"; return; }
        if (!res.ok) throw new Error("Failed to load stores");
        const data = (await res.json()) as { stores: MerchStore[] };
        setStores(data.stores);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filteredStores = stores.filter(
    (s) =>
      s.storeName.toLowerCase().includes(search.toLowerCase()) ||
      s.creatorUsername.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Merch Stores</h1>
        <p className="mt-1 text-sm text-neutral-500">Shop merchandise from your favourite creators.</p>
      </div>

      {/* Search */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search stores or creators…"
          className="w-full rounded-xl border border-neutral-300 bg-neutral-50 py-2.5 pl-9 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <StoreSkeleton key={i} />)}
        </div>
      ) : filteredStores.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-neutral-200 bg-white py-20 dark:border-neutral-800 dark:bg-neutral-900">
          <span className="text-5xl">🛍️</span>
          <p className="mt-3 text-lg font-semibold text-neutral-700 dark:text-neutral-300">
            {search ? "No stores match your search" : "No stores yet"}
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            {search ? "Try a different search term." : "Creator stores will appear here."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredStores.map((store) => (
            <StoreCard key={store.creatorId} store={store} />
          ))}
        </div>
      )}
    </div>
  );
}
