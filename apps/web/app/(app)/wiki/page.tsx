"use client";

/**
 * app/(app)/wiki/page.tsx
 *
 * Wiki discovery — Popular / Trending / New / Random tabs, search, card
 * grid, cursor-based "Load more". Mirrors app/(app)/blogs/page.tsx's
 * structure. Wikis have no subscriptions, so there's no Subscribed tab.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

interface WikiSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  contribute_policy: string;
  page_count: number;
  contributor_count: number;
  view_count: number;
  owner_username: string | null;
}

type Tab = "popular" | "trending" | "new" | "random";

const TABS: { key: Tab; icon: string; labelKey: string; fallback: string }[] = [
  { key: "popular", icon: "🔥", labelKey: "wiki.tab.popular", fallback: "Popular" },
  { key: "trending", icon: "📈", labelKey: "wiki.tab.trending", fallback: "Trending" },
  { key: "new", icon: "✨", labelKey: "wiki.tab.new", fallback: "New" },
  { key: "random", icon: "🔀", labelKey: "wiki.tab.random", fallback: "Random" },
];

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 1 : 2)}K`;
  return String(n);
}

function WikiCard({ w, t }: { w: WikiSummary; t: (k: string, d: string, o?: Record<string, unknown>) => string }) {
  return (
    <Link
      href={`/wiki/${w.slug}`}
      className="group relative flex flex-col rounded-2xl border border-border bg-card p-4 hover:border-primary/60 hover:shadow-lg transition-all"
    >
      {w.cover_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={w.cover_image_url} alt={w.name} className="mb-3 h-24 w-full rounded-xl object-cover" />
      ) : (
        <div className="mb-3 flex items-center justify-center h-24 rounded-xl bg-neutral-800 text-4xl">📚</div>
      )}
      <div className="font-bold text-foreground text-sm leading-tight">{w.name}</div>
      {w.description && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{w.description}</div>}
      {w.owner_username && <div className="text-[10px] text-muted-foreground mt-1">@{w.owner_username}</div>}
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-muted-foreground">{t("wiki.card.pages", "{{count}} pages", { count: w.page_count })}</span>
        <span className="text-[10px] text-emerald-500">{t("wiki.card.contributors", "{{count}} contributors", { count: w.contributor_count })}</span>
        <span className="text-[10px] text-muted-foreground">{formatCount(w.view_count)} views</span>
      </div>
    </Link>
  );
}

export default function WikiDiscoveryPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("popular");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [wikis, setWikis] = useState<WikiSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const buildUrl = useCallback((overCursor?: string | null) => {
    const p = new URLSearchParams({ tab });
    if (search.trim()) p.set("q", search.trim());
    if (overCursor) p.set("cursor", overCursor);
    return `/api/wiki?${p.toString()}`;
  }, [tab, search]);

  const cursorRef = useRef<string | null>(null);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);

  const fetchWikis = useCallback(async (reset = true) => {
    if (reset) { setLoading(true); setCursor(null); }
    else setLoadingMore(true);
    try {
      const url = reset ? buildUrl(null) : buildUrl(cursorRef.current);
      const res = await fetch(url, { credentials: "include" });
      const body = await res.json();
      const data = body?.data;
      const newWikis: WikiSummary[] = data?.wikis ?? [];
      setWikis(reset ? newWikis : (prev) => [...prev, ...newWikis]);
      setCursor(data?.nextCursor ?? null);
      setHasMore(data?.hasMore ?? false);
    } catch { /* ignore */ } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [buildUrl]);

  useEffect(() => { void fetchWikis(true); }, [tab, search]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-foreground">{t("wiki.title", "Wikis")}</h1>
        <div className="flex gap-2">
          <Link
            href="/wiki/me"
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            {t("wiki.myWikis", "My Wikis")}
          </Link>
          <Link
            href="/wiki/new"
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            {t("wiki.createCta", "Create a wiki")}
          </Link>
        </div>
      </div>

      <div className="relative mb-4">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("wiki.search.placeholder", "Search wikis…")}
          className="w-full rounded-xl border border-border bg-card py-2.5 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="flex gap-1 mb-4 overflow-x-auto bg-neutral-900/50 rounded-xl p-1">
        {TABS.map(({ key, icon, labelKey, fallback }) => (
          <button
            key={key}
            type="button"
            onClick={() => { setTab(key); setWikis([]); setCursor(null); }}
            className={`flex-shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
              tab === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span aria-hidden="true">{icon}</span>
            <span>{t(labelKey, fallback)}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 rounded-2xl bg-neutral-800 animate-pulse" />
          ))}
        </div>
      ) : wikis.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <div className="text-4xl mb-3">📚</div>
          <p>
            {search.trim()
              ? t("wiki.empty.search", "No wikis found for \"{{query}}\".", { query: search.trim() })
              : t("wiki.empty", "No wikis yet — be the first to start one.")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {wikis.map((w) => <WikiCard key={w.slug} w={w} t={t} />)}
        </div>
      )}

      {hasMore && !loading && (
        <div className="flex justify-center mt-6">
          <button
            type="button"
            onClick={() => void fetchWikis(false)}
            disabled={loadingMore}
            className="px-6 py-3 rounded-xl border border-border bg-card text-sm font-semibold text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
          >
            {loadingMore ? t("wiki.loading", "Loading…") : t("wiki.loadMore", "Load more")}
          </button>
        </div>
      )}
    </div>
  );
}
