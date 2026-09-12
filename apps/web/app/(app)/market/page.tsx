"use client";

/**
 * app/(app)/market/page.tsx
 *
 * The Market — a unified browse page for everything purchasable: creator
 * digital/physical items, platform cosmetics/themes, boosts/passes, and
 * credit top-ups.
 *
 * Sections (see lib/market/query.ts for the backing rules):
 *   - Sponsored:  creator-paid promotion, capped at 2 rows in grid mode.
 *   - Featured:   admin-curated creator + platform items, capped at 2 rows.
 *   - Trending:   weighted-random rotation favoring popular creator items,
 *                 capped at 2 rows — "fair rotation" so every active item
 *                 gets discovered, popular ones just show up more often.
 *   - Platform:   all platform items (cosmetics/themes/boosts/credits),
 *                 capped at 3 rows.
 *
 * Each section has a "View more" link to /market/[section] for the full,
 * paginated, sortable/filterable listing. List/grid mode and category are
 * shared across sections via query state carried into "View more".
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import type { MarketItem } from "@/lib/market/types";
import { MarketItemCard } from "@/components/market/MarketItemCard";

type ViewMode = "grid" | "list";

interface MarketHome {
  sponsored: MarketItem[];
  featured: MarketItem[];
  trending: MarketItem[];
  platform: MarketItem[];
}

function SectionSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-48 animate-pulse rounded-2xl bg-neutral-200 dark:bg-neutral-800" />
      ))}
    </div>
  );
}

function Section({
  title,
  items,
  section,
  view,
  emptyLabel,
}: {
  title: string;
  items: MarketItem[];
  section: string;
  view: ViewMode;
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-50">{title}</h2>
        <Link href={`/market/${section}?view=${view}`} className="text-sm text-blue-600 hover:underline">
          View more →
        </Link>
      </div>
      <div className={view === "grid" ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "space-y-2"}>
        {items.map((item) => (
          <MarketItemCard key={`${item.kind}:${item.id}`} item={item} view={view} />
        ))}
      </div>
      {items.length === 0 && <p className="text-sm text-neutral-500">{emptyLabel}</p>}
    </section>
  );
}

export default function MarketPage() {
  const { t } = useTranslation();
  const [home, setHome] = useState<MarketHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("grid");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/market");
        if (!res.ok) throw new Error("Failed to load the Market");
        const json = (await res.json()) as { data?: MarketHome };
        setHome(json.data ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load the Market");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">🏪 Market</h1>
          <p className="text-sm text-neutral-500">Credits, cosmetics, boosts, and items from creators — all in one place.</p>
        </div>
        <div className="flex gap-0.5 rounded-lg border border-neutral-200 bg-white p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
          <button
            type="button"
            onClick={() => setView("list")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${view === "list" ? "bg-blue-600 text-white" : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"}`}
          >
            ☰ {t("games.view.list")}
          </button>
          <button
            type="button"
            onClick={() => setView("grid")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${view === "grid" ? "bg-blue-600 text-white" : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"}`}
          >
            ⊞ {t("games.view.grid")}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading || !home ? (
        <div className="space-y-8">
          <SectionSkeleton />
          <SectionSkeleton />
        </div>
      ) : (
        <>
          <Section title="🚀 Sponsored" items={home.sponsored} section="sponsored" view={view} emptyLabel="" />
          <Section title="⭐ Featured" items={home.featured} section="featured" view={view} emptyLabel="" />
          <Section title="🔥 Trending from Creators" items={home.trending} section="trending" view={view} emptyLabel="No creator items yet." />
          <Section title="🛒 Platform Store" items={home.platform} section="platform" view={view} emptyLabel="" />
        </>
      )}
    </div>
  );
}
