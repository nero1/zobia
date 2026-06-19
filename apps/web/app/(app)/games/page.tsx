"use client";

/**
 * app/(app)/games/page.tsx
 *
 * Games discovery — New / Popular / Trending tabs + category + free/paid filter.
 * Card and list view toggle. Cursor-based pagination (Load More).
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { GAME_CATEGORIES } from "@zobia/types";

interface GameSummary {
  slug: string;
  name: string;
  tagline: string | null;
  coverEmoji: string;
  coverImageUrl: string | null;
  category: string | null;
  rewardCreditsPerWin: number;
  rewardXpPerWin: number;
  rewardStarsPerWin: number;
  playCostCredits: number;
  playCostStars: number;
  avgRating: number;
  ratingCount: number;
  playCount: number;
}

type Tab = "popular" | "new" | "trending";
type ViewMode = "card" | "list";

function formatPlayCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(n >= 10_000 ? 1 : 2)}K`;
  return String(n);
}

function StarRating({ rating, count }: { rating: number; count: number }) {
  if (!count) return null;
  const stars = Math.round(rating);
  return (
    <span className="flex items-center gap-0.5 text-amber-400 text-xs">
      {"★".repeat(stars)}{"☆".repeat(Math.max(0, 5 - stars))}
      <span className="text-muted-foreground ml-1">({count})</span>
    </span>
  );
}

function CostBadge({ credits, stars }: { credits: number; stars: number }) {
  if (!credits && !stars) return <span className="text-emerald-500 text-xs font-medium">Free</span>;
  return (
    <span className="text-amber-500 text-xs font-medium">
      {credits > 0 ? `${credits}¢` : ""}
      {credits > 0 && stars > 0 ? " + " : ""}
      {stars > 0 ? `${stars}⭐` : ""}
    </span>
  );
}

function GameCard({ g }: { g: GameSummary }) {
  return (
    <Link
      href={`/g/${g.slug}/play`}
      className="group flex flex-col rounded-2xl border border-border bg-card p-4 hover:border-primary/60 hover:shadow-lg transition-all"
    >
      {g.coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={g.coverImageUrl} alt={g.name} className="mb-3 h-24 w-full rounded-xl object-cover" />
      ) : (
        <div className="mb-3 flex items-center justify-center h-24 rounded-xl bg-neutral-800 text-5xl">
          {g.coverEmoji}
        </div>
      )}
      <div className="font-bold text-foreground text-sm leading-tight">{g.name}</div>
      {g.tagline && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{g.tagline}</div>}
      {g.category && (
        <span className="mt-2 inline-block self-start rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-medium text-neutral-300">
          {g.category}
        </span>
      )}
      <div className="mt-2 flex items-center justify-between gap-1">
        <CostBadge credits={g.playCostCredits} stars={g.playCostStars} />
        {g.playCount > 0 && (
          <span className="text-muted-foreground text-[10px]">{formatPlayCount(g.playCount)} plays</span>
        )}
      </div>
      {g.ratingCount > 0 && <StarRating rating={g.avgRating} count={g.ratingCount} />}
    </Link>
  );
}

function GameRow({ g }: { g: GameSummary }) {
  return (
    <Link
      href={`/g/${g.slug}/play`}
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 hover:border-primary/60 hover:bg-accent/50 transition-all"
    >
      <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-xl bg-neutral-800 text-2xl">
        {g.coverEmoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-foreground text-sm truncate">{g.name}</div>
        {g.tagline && <div className="text-xs text-muted-foreground truncate">{g.tagline}</div>}
        <div className="flex items-center gap-2 mt-0.5">
          {g.category && (
            <span className="text-[10px] bg-neutral-800 text-neutral-400 rounded-full px-1.5 py-0.5">{g.category}</span>
          )}
          <CostBadge credits={g.playCostCredits} stars={g.playCostStars} />
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        {g.ratingCount > 0 && <StarRating rating={g.avgRating} count={g.ratingCount} />}
        {g.playCount > 0 && (
          <div className="text-[10px] text-muted-foreground mt-0.5">{formatPlayCount(g.playCount)} plays</div>
        )}
      </div>
    </Link>
  );
}

export default function GamesDiscoveryPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("popular");
  const [category, setCategory] = useState<string | null>(null);
  const [freeFilter, setFreeFilter] = useState<boolean | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("card");
  const [games, setGames] = useState<GameSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [disabled, setDisabled] = useState(false);

  const buildUrl = useCallback((overCursor?: string | null) => {
    const p = new URLSearchParams({ tab });
    if (category) p.set("category", category);
    if (freeFilter !== null) p.set("free", String(freeFilter));
    if (overCursor) p.set("cursor", overCursor);
    return `/api/games?${p.toString()}`;
  }, [tab, category, freeFilter]);

  const fetchGames = useCallback(async (reset = true) => {
    if (reset) { setLoading(true); setCursor(null); }
    else setLoadingMore(true);

    try {
      const url = reset ? buildUrl(null) : buildUrl(cursor);
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 403) { setDisabled(true); return; }
      const body = await res.json();
      const data = body?.data;
      const newGames: GameSummary[] = data?.games ?? [];
      if (reset) setGames(newGames);
      else setGames(prev => [...prev, ...newGames]);
      setCursor(data?.nextCursor ?? null);
      setHasMore(data?.hasMore ?? false);
    } catch { /* ignore */ } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [buildUrl, cursor]);

  useEffect(() => { void fetchGames(true); }, [tab, category, freeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  if (disabled) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <div className="mb-4 text-5xl">🎮</div>
        <h1 className="text-2xl font-bold">{t("games.unavailableTitle")}</h1>
        <p className="mt-2 text-muted-foreground">{t("games.unavailableBody")}</p>
      </div>
    );
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "popular",  label: "🔥 Popular"  },
    { key: "trending", label: "📈 Trending" },
    { key: "new",      label: "✨ New"      },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t("games.title", "Games")}</h1>
        <div className="flex gap-2 text-xs">
          <Link href="/games/challenges" className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground hover:bg-accent">
            {t("games.challenges", "Challenges")}
          </Link>
          <Link href="/games/leaderboards" className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground hover:bg-accent">
            {t("games.leaderboards", "Leaderboards")}
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-neutral-900/50 rounded-xl p-1">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
        {/* Free/Paid */}
        <button
          type="button"
          onClick={() => setFreeFilter(null)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            freeFilter === null ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => setFreeFilter(f => f === true ? null : true)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            freeFilter === true ? "border-emerald-500 bg-emerald-950/40 text-emerald-400" : "border-border bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          Free
        </button>
        <button
          type="button"
          onClick={() => setFreeFilter(f => f === false ? null : false)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            freeFilter === false ? "border-amber-500 bg-amber-950/40 text-amber-400" : "border-border bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          Paid
        </button>

        <div className="w-px h-4 bg-border mx-1 flex-shrink-0" />

        {/* Category chips */}
        {GAME_CATEGORIES.map(cat => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(c => c === cat ? null : cat)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              category === cat
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* View toggle */}
      <div className="flex justify-end mb-3">
        <div className="flex rounded-lg border border-border bg-card p-0.5 gap-0.5">
          <button
            type="button"
            onClick={() => setViewMode("card")}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === "card" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            ⊞ Grid
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            ☰ List
          </button>
        </div>
      </div>

      {/* Games */}
      {loading ? (
        <div className={viewMode === "card" ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "flex flex-col gap-2"}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-40 rounded-2xl bg-neutral-800 animate-pulse" />
          ))}
        </div>
      ) : games.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <div className="text-4xl mb-3">🎮</div>
          <p>No games found for this filter.</p>
        </div>
      ) : viewMode === "card" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {games.map(g => <GameCard key={g.slug} g={g} />)}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {games.map(g => <GameRow key={g.slug} g={g} />)}
        </div>
      )}

      {/* Load more */}
      {hasMore && !loading && (
        <div className="flex justify-center mt-6">
          <button
            type="button"
            onClick={() => void fetchGames(false)}
            disabled={loadingMore}
            className="px-6 py-3 rounded-xl border border-border bg-card text-sm font-semibold text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
