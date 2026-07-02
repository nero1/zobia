"use client";

/**
 * app/(app)/games/page.tsx
 *
 * Games discovery — Popular / Trending / New / ❤️ Faves / 🔀 Random /
 * 🕐 Recently Played tabs, search bar, category + free/paid filters, card
 * and list view toggle, cursor-based pagination (Load More).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { GAME_CATEGORIES } from "@zobia/types";

interface GameSummary {
  id: string;
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
  favoriteCount: number;
  isFavorited?: boolean;
}

type Tab = "popular" | "trending" | "new" | "faves" | "random" | "recent";
type ViewMode = "card" | "list";

const TABS: { key: Tab; icon: string; labelKey: string; fallback: string }[] = [
  { key: "popular",  icon: "🔥", labelKey: "games.tab.popular",  fallback: "Popular" },
  { key: "trending", icon: "📈", labelKey: "games.tab.trending", fallback: "Trending" },
  { key: "new",      icon: "✨", labelKey: "games.tab.new",      fallback: "New" },
  { key: "faves",    icon: "❤️", labelKey: "games.tab.faves",    fallback: "Faves" },
  { key: "random",   icon: "🔀", labelKey: "games.tab.random",   fallback: "Random" },
  { key: "recent",   icon: "🕐", labelKey: "games.tab.recent",   fallback: "Recently Played" },
];

// Faves and Recently Played are backed by dedicated endpoints (game_favorites
// / game_plays) rather than the main discovery query, so category/free
// filters and search don't apply to them — same convention as the Rooms
// discovery page's "recent"/"faves" tabs.
function isDedicatedTab(tab: Tab): boolean {
  return tab === "faves" || tab === "recent";
}

function formatCount(n: number): string {
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

function FaveButton({ favorited, onToggle }: { favorited: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={favorited ? "Unfavorite" : "Favorite"}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
      className="flex-shrink-0 rounded-full bg-black/40 p-1.5 text-base leading-none backdrop-blur-sm transition-transform hover:scale-110 active:scale-95"
    >
      {favorited ? "❤️" : "🤍"}
    </button>
  );
}

function GameCard({ g, onToggleFavorite }: { g: GameSummary; onToggleFavorite: (id: string, next: boolean) => void }) {
  return (
    <Link
      href={`/g/${g.slug}/play`}
      className="group relative flex flex-col rounded-2xl border border-border bg-card p-4 hover:border-primary/60 hover:shadow-lg transition-all"
    >
      <div className="absolute right-3 top-3 z-10">
        <FaveButton favorited={!!g.isFavorited} onToggle={() => onToggleFavorite(g.id, !g.isFavorited)} />
      </div>
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
        <div className="flex items-center gap-1.5">
          {g.favoriteCount > 0 && (
            <span className="text-[10px] text-rose-400">❤️{formatCount(g.favoriteCount)}</span>
          )}
          {g.playCount > 0 && (
            <span className="text-muted-foreground text-[10px]">{formatCount(g.playCount)} plays</span>
          )}
        </div>
      </div>
      {g.ratingCount > 0 && <StarRating rating={g.avgRating} count={g.ratingCount} />}
    </Link>
  );
}

function GameRow({ g, onToggleFavorite }: { g: GameSummary; onToggleFavorite: (id: string, next: boolean) => void }) {
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
      <div className="flex-shrink-0 flex items-center gap-2">
        <div className="text-right">
          {g.ratingCount > 0 && <StarRating rating={g.avgRating} count={g.ratingCount} />}
          <div className="flex items-center justify-end gap-1.5 mt-0.5">
            {g.favoriteCount > 0 && <span className="text-[10px] text-rose-400">❤️{formatCount(g.favoriteCount)}</span>}
            {g.playCount > 0 && <span className="text-[10px] text-muted-foreground">{formatCount(g.playCount)} plays</span>}
          </div>
        </div>
        <FaveButton favorited={!!g.isFavorited} onToggle={() => onToggleFavorite(g.id, !g.isFavorited)} />
      </div>
    </Link>
  );
}

export default function GamesDiscoveryPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("popular");
  const [category, setCategory] = useState<string | null>(null);
  const [freeFilter, setFreeFilter] = useState<boolean | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("card");
  const [games, setGames] = useState<GameSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [disabled, setDisabled] = useState(false);

  // Debounce the search box (250ms) so typing doesn't fire a request per
  // keystroke — with a catalogue in the tens of thousands this keeps the
  // ILIKE query volume low; a trigram index (pg_trgm) on games.name is the
  // next scaling step if the catalogue grows well beyond that.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const dedicated = isDedicatedTab(tab);

  const buildUrl = useCallback((overCursor?: string | null) => {
    if (tab === "faves") {
      const p = new URLSearchParams();
      if (overCursor) p.set("cursor", overCursor);
      return `/api/games/favorites?${p.toString()}`;
    }
    if (tab === "recent") {
      const p = new URLSearchParams();
      if (overCursor) p.set("cursor", overCursor);
      return `/api/games/recent?${p.toString()}`;
    }
    const p = new URLSearchParams({ tab });
    if (category) p.set("category", category);
    if (freeFilter !== null) p.set("free", String(freeFilter));
    if (search.trim()) p.set("q", search.trim());
    if (overCursor) p.set("cursor", overCursor);
    return `/api/games?${p.toString()}`;
  }, [tab, category, freeFilter, search]);

  const cursorRef = useRef<string | null>(null);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);

  const fetchGames = useCallback(async (reset = true) => {
    if (reset) { setLoading(true); setCursor(null); }
    else setLoadingMore(true);

    try {
      const url = reset ? buildUrl(null) : buildUrl(cursorRef.current);
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
  }, [buildUrl]);

  useEffect(() => { void fetchGames(true); }, [tab, category, freeFilter, search]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleToggleFavorite(gameId: string, next: boolean) {
    setGames((prev) => prev.map((g) => g.id === gameId
      ? { ...g, isFavorited: next, favoriteCount: Math.max(0, g.favoriteCount + (next ? 1 : -1)) }
      : g));
    try {
      const res = await fetch("/api/games/favorites", {
        method: next ? "POST" : "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId }),
      });
      if (!res.ok) throw new Error("failed");
      if (tab === "faves" && !next) {
        setGames((prev) => prev.filter((g) => g.id !== gameId));
      }
    } catch {
      // Revert on failure
      setGames((prev) => prev.map((g) => g.id === gameId
        ? { ...g, isFavorited: !next, favoriteCount: Math.max(0, g.favoriteCount + (next ? -1 : 1)) }
        : g));
    }
  }

  if (disabled) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <div className="mb-4 text-5xl">🎮</div>
        <h1 className="text-2xl font-bold">{t("games.unavailableTitle")}</h1>
        <p className="mt-2 text-muted-foreground">{t("games.unavailableBody")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t("games.title", "Games")}</h1>
        <div className="flex gap-2 text-xs">
          <Link href="/games/saved" className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground hover:bg-accent">
            {t("games.savedGames.title", "Saved Games")}
          </Link>
          <Link href="/games/challenges" className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground hover:bg-accent">
            {t("games.challenges", "Challenges")}
          </Link>
          <Link href="/leaderboards?track=gaming" className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium text-foreground hover:bg-accent">
            {t("games.leaderboards", "Leaderboards")}
          </Link>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("games.search.placeholder", "Search games…")}
          className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto bg-neutral-900/50 rounded-xl p-1">
        {TABS.map(({ key, icon, labelKey, fallback }) => (
          <button
            key={key}
            type="button"
            onClick={() => { setTab(key); setGames([]); setCursor(null); }}
            className={`flex-shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
              tab === key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span aria-hidden="true">{icon}</span>
            <span>{t(labelKey, fallback)}</span>
          </button>
        ))}
      </div>

      {!dedicated && (
        <>
          {/* Category dropdown — quicker than scrolling the chip row once there are 13+ categories */}
          <div className="mb-3">
            <select
              value={category ?? ""}
              onChange={(e) => setCategory(e.target.value || null)}
              aria-label={t("games.filter.categoryLabel", "Filter by category")}
              className="w-full rounded-xl border border-border bg-card py-2.5 px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary sm:w-56"
            >
              <option value="">{t("games.filter.allCategories", "All categories")}</option>
              {GAME_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
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
              {t("games.filter.all", "All")}
            </button>
            <button
              type="button"
              onClick={() => setFreeFilter(f => f === true ? null : true)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                freeFilter === true ? "border-emerald-500 bg-emerald-950/40 text-emerald-400" : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("games.filter.free", "Free")}
            </button>
            <button
              type="button"
              onClick={() => setFreeFilter(f => f === false ? null : false)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                freeFilter === false ? "border-amber-500 bg-amber-950/40 text-amber-400" : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("games.filter.paid", "Paid")}
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
        </>
      )}

      {/* View toggle */}
      <div className="flex justify-end mb-3">
        <div className="flex rounded-lg border border-border bg-card p-0.5 gap-0.5">
          <button
            type="button"
            onClick={() => setViewMode("card")}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === "card" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            ⊞ {t("games.view.grid", "Grid")}
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            ☰ {t("games.view.list", "List")}
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
          <div className="text-4xl mb-3">{tab === "faves" ? "❤️" : tab === "recent" ? "🕐" : "🎮"}</div>
          <p>
            {tab === "faves"
              ? t("games.faves.empty", "No favorite games yet — tap the heart on a game to save it here.")
              : tab === "recent"
              ? t("games.recent.empty", "Games you play will show up here.")
              : search.trim()
              ? t("games.empty.search", "No games found for \"{{query}}\".", { query: search.trim() })
              : t("games.empty.filter", "No games found for this filter.")}
          </p>
        </div>
      ) : viewMode === "card" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {games.map(g => <GameCard key={g.slug} g={g} onToggleFavorite={handleToggleFavorite} />)}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {games.map(g => <GameRow key={g.slug} g={g} onToggleFavorite={handleToggleFavorite} />)}
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
            {loadingMore ? t("games.loading", "Loading…") : t("games.loadMore", "Load more")}
          </button>
        </div>
      )}

      {/* Random tab: no stable pagination — offer a reshuffle instead */}
      {tab === "random" && !loading && !hasMore && games.length > 0 && (
        <div className="flex justify-center mt-6">
          <button
            type="button"
            onClick={() => void fetchGames(true)}
            className="px-6 py-3 rounded-xl border border-border bg-card text-sm font-semibold text-foreground hover:bg-accent transition-colors"
          >
            🔀 {t("games.shuffle", "Shuffle again")}
          </button>
        </div>
      )}
    </div>
  );
}
