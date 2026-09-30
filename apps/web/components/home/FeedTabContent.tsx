"use client";

/**
 * components/home/FeedTabContent.tsx
 *
 * Cursor-paginated feed list for one Home Feed tab, copying the exact
 * "Load more" convention used by app/(app)/tweets/page.tsx (cursor state,
 * fetchPage, append results, skeleton while loading) — see that file. Ads
 * (the separate platform ad system, AdSlot) are interleaved every ~5-6
 * items via placement "home_feed_native"; this is unrelated to any
 * boosted/native items the feed itself may already contain
 * (FeedItem.isBoosted/isInHouseBoosted), which render as regular cards with
 * a "Sponsored" tag (see FeedItemCard).
 *
 * Responses are cached briefly client-side (sessionStorage, short TTL) so
 * switching tabs back and forth doesn't refetch instantly — acceptable
 * given the backend's own 10-15 min staleness tolerance.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AdSlot from "@/components/ads/AdSlot";
import { Icon } from "@/components/ui/Icon";
import type { FeedTab, FeedPage } from "@/lib/feed/types";
import type { PortalCard } from "@zobia/types";
import { PortalSuggestionCard } from "@/components/portals/PortalSuggestionCard";

/** A "Portals for you" card pinned after the Nth item of the flattened list. */
interface PlacedSuggestion {
  at: number;
  portals: PortalCard[];
}

interface CachedFeedPage {
  items: FeedItemView[];
  nextCursor: string | null;
  suggestions?: PlacedSuggestion[];
}
import { FeedItemCard, FeedItemCardSkeleton, type FeedItemView } from "./FeedItemCard";

const ADS_EVERY_N_ITEMS = 6;
const CACHE_TTL_MS = 10 * 60 * 1000;

function cacheKey(tab: FeedTab): string {
  return `zobia:home:feed:${tab}:v2`;
}

function readCache(tab: FeedTab): CachedFeedPage | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(tab));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; page: CachedFeedPage };
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.page;
  } catch {
    return null;
  }
}

function writeCache(tab: FeedTab, page: CachedFeedPage) {
  try {
    sessionStorage.setItem(cacheKey(tab), JSON.stringify({ at: Date.now(), page }));
  } catch {
    // best-effort
  }
}

export function FeedTabContent({ tab, refreshSignal }: { tab: FeedTab; refreshSignal?: number }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<FeedItemView[] | undefined>(undefined);
  const [cursor, setCursor] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PlacedSuggestion[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const fetchPage = useCallback(async (cursorParam: string | null): Promise<FeedPage> => {
    const params = new URLSearchParams({ tab, limit: "20" });
    if (cursorParam) params.set("cursor", cursorParam);
    const res = await fetch(`/api/feed?${params.toString()}`, { credentials: "include" });
    if (!res.ok) throw new Error("Failed to load feed");
    const json = (await res.json()) as { data?: FeedPage };
    return json.data ?? { items: [], nextCursor: null };
  }, [tab]);

  const load = useCallback(async (useCache: boolean) => {
    setError(null);
    if (useCache) {
      const cached = readCache(tab);
      if (cached) {
        setItems(cached.items as FeedItemView[]);
        setCursor(cached.nextCursor);
        setSuggestions(cached.suggestions ?? []);
        return;
      }
    }
    setItems(undefined);
    setCursor(null);
    setSuggestions([]);
    try {
      const page = await fetchPage(null);
      if (!mountedRef.current) return;
      const placed = page.portalSuggestion ? [{ at: page.portalSuggestion.afterIndex, portals: page.portalSuggestion.portals }] : [];
      setItems(page.items as FeedItemView[]);
      setCursor(page.nextCursor);
      setSuggestions(placed);
      writeCache(tab, { items: page.items as FeedItemView[], nextCursor: page.nextCursor, suggestions: placed });
    } catch {
      if (!mountedRef.current) return;
      setError(t("feedTabs.loadError"));
      setItems([]);
    }
  }, [tab, fetchPage, t]);

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const isFirstRefreshSignal = useRef(true);
  useEffect(() => {
    if (isFirstRefreshSignal.current) {
      isFirstRefreshSignal.current = false;
      return;
    }
    load(false); // pull-to-refresh — bypass cache
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const handleLoadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(cursor);
      if (!mountedRef.current) return;
      const baseLength = items?.length ?? 0;
      const nextSuggestions = page.portalSuggestion
        ? [...suggestions, { at: baseLength + page.portalSuggestion.afterIndex, portals: page.portalSuggestion.portals }]
        : suggestions;
      const merged = [...(items ?? []), ...(page.items as FeedItemView[])];
      setItems(merged);
      setSuggestions(nextSuggestions);
      writeCache(tab, { items: merged, nextCursor: page.nextCursor, suggestions: nextSuggestions });
      setCursor(page.nextCursor);
    } catch {
      // non-fatal — retry via the button
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [cursor, loadingMore, fetchPage, tab, items, suggestions]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (items === undefined) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <FeedItemCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-10 text-center dark:border-neutral-700 dark:bg-neutral-900">
        <div className="mb-2"><Icon emoji="🗂️" size={32} /></div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("feedTabs.empty")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={`${item.contentType}:${item.contentId}:${i}`} className="space-y-3">
          <FeedItemCard item={item} />
          {(i + 1) % ADS_EVERY_N_ITEMS === 0 && (
            <AdSlot placement="home_feed_native" />
          )}
          {suggestions.filter((sg) => sg.at === i + 1).map((sg) => (
            <PortalSuggestionCard key={`portals-${sg.at}`} portals={sg.portals} />
          ))}
        </div>
      ))}
      {cursor && (
        <button
          onClick={handleLoadMore}
          disabled={loadingMore}
          className="w-full rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {loadingMore ? t("feedTabs.loadingMore") : t("feedTabs.loadMore")}
        </button>
      )}
    </div>
  );
}
