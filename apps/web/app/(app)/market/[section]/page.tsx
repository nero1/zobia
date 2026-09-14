"use client";

/**
 * app/(app)/market/[section]/page.tsx
 *
 * "View more" — full, paginated listing for one Market section, with
 * category filter and sort (price/popularity/rating — rating & popularity
 * only apply to creator items, see lib/market/query.ts).
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { MarketItem, MarketCategory, MarketSort } from "@/lib/market/types";
import { MarketItemCard } from "@/components/market/MarketItemCard";

type ViewMode = "grid" | "list";

const SECTION_TITLE: Record<string, string> = {
  sponsored: "🚀 Sponsored",
  featured: "⭐ Featured",
  trending: "🔥 Trending from Creators",
  platform: "🛒 Platform Store",
};

const CATEGORIES: { value: MarketCategory | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "digital", label: "Digital" },
  { value: "physical", label: "Physical" },
  { value: "cosmetics_themes", label: "Cosmetics & Themes" },
  { value: "boosts_passes", label: "Boosts & Passes" },
  { value: "credits", label: "Credits" },
];

const PAGE_SIZE = 24;

export default function MarketSectionPage() {
  const { section } = useParams<{ section: string }>() ?? { section: "" };
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useTranslation();

  const [view, setView] = useState<ViewMode>((searchParams?.get("view") as ViewMode) || "grid");
  const [category, setCategory] = useState<MarketCategory | "all">("all");
  const [sort, setSort] = useState<MarketSort>("popularity");
  const [items, setItems] = useState<MarketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isCreatorSortable = section === "trending" || category === "digital" || category === "physical";

  const load = useCallback(
    async (offset: number, append: boolean) => {
      append ? setLoadingMore(true) : setLoading(true);
      try {
        const params = new URLSearchParams({
          section,
          sort,
          limit: String(PAGE_SIZE),
          offset: String(offset),
        });
        if (category !== "all") params.set("category", category);
        const res = await fetch(`/api/market/section?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load items");
        const json = (await res.json()) as { data?: { items: MarketItem[] } };
        const newItems = json.data?.items ?? [];
        setItems((prev) => (append ? [...prev, ...newItems] : newItems));
        setHasMore(newItems.length === PAGE_SIZE);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load items");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [section, sort, category]
  );

  useEffect(() => {
    void load(0, false);
  }, [load]);

  function updateView(v: ViewMode) {
    setView(v);
    const params = new URLSearchParams(searchParams?.toString());
    params.set("view", v);
    router.replace(`/market/${section}?${params.toString()}`);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/market" className="text-sm text-neutral-500 hover:underline">← Market</Link>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">{SECTION_TITLE[section] ?? section}</h1>
        </div>
        <div className="flex gap-0.5 rounded-lg border border-neutral-200 bg-white p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
          <button
            type="button"
            onClick={() => updateView("list")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${view === "list" ? "bg-blue-600 text-white" : "text-neutral-500"}`}
          >
            ☰ {t("games.view.list")}
          </button>
          <button
            type="button"
            onClick={() => updateView("grid")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${view === "grid" ? "bg-blue-600 text-white" : "text-neutral-500"}`}
          >
            ⊞ {t("games.view.grid")}
          </button>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setCategory(c.value)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              category === c.value
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-neutral-200 text-neutral-600 hover:border-blue-300 dark:border-neutral-700 dark:text-neutral-300"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Sort — only meaningful for creator items */}
      {isCreatorSortable && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-neutral-500">Sort by:</span>
          {(["popularity", "price", "rating"] as MarketSort[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                sort === s ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
              }`}
            >
              {s === "popularity" ? "Popular" : s === "price" ? "Price" : "Rating"}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-2xl bg-neutral-200 dark:bg-neutral-800" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-sm text-neutral-500">Nothing here yet.</p>
      ) : (
        <>
          <div className={view === "grid" ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "space-y-2"}>
            {items.map((item) => (
              <MarketItemCard key={`${item.kind}:${item.id}`} item={item} view={view} />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => load(items.length, true)}
                disabled={loadingMore}
                className="rounded-xl border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
