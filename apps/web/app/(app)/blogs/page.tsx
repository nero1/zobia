"use client";

/**
 * app/(app)/blogs/page.tsx
 *
 * Blogs discovery — Popular / Trending / New / Random tabs, search bar,
 * card grid, cursor-based pagination (Load More). Mirrors the Games
 * discovery page's structure (app/(app)/games/page.tsx).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

interface BlogSummary {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  subscriber_count: number;
  show_subscriber_count: boolean;
  post_count: number;
  owner_username: string | null;
}

type Tab = "popular" | "trending" | "new" | "random" | "subscribed";

const TABS: { key: Tab; icon: string; labelKey: string; fallback: string }[] = [
  { key: "popular", icon: "🔥", labelKey: "blogs.tab.popular", fallback: "Popular" },
  { key: "trending", icon: "📈", labelKey: "blogs.tab.trending", fallback: "Trending" },
  { key: "new", icon: "✨", labelKey: "blogs.tab.new", fallback: "New" },
  { key: "random", icon: "🔀", labelKey: "blogs.tab.random", fallback: "Random" },
  { key: "subscribed", icon: "🔔", labelKey: "blogs.tab.subscribed", fallback: "Subscribed" },
];

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 1 : 2)}K`;
  return String(n);
}

function BlogCard({ b }: { b: BlogSummary }) {
  return (
    <Link
      href={`/b/${b.slug}`}
      className="group relative flex flex-col rounded-2xl border border-border bg-card p-4 hover:border-primary/60 hover:shadow-lg transition-all"
    >
      {b.cover_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={b.cover_image_url} alt={b.title} className="mb-3 h-24 w-full rounded-xl object-cover" />
      ) : (
        <div className="mb-3 flex items-center justify-center h-24 rounded-xl bg-neutral-800 text-4xl">📝</div>
      )}
      <div className="font-bold text-foreground text-sm leading-tight">{b.title}</div>
      {b.tagline && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{b.tagline}</div>}
      {b.owner_username && <div className="text-[10px] text-muted-foreground mt-1">@{b.owner_username}</div>}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">{formatCount(b.post_count)} posts</span>
        {b.show_subscriber_count && (
          <span className="text-[10px] text-emerald-500">{formatCount(b.subscriber_count)} subscribers</span>
        )}
      </div>
    </Link>
  );
}

export default function BlogsDiscoveryPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("popular");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [blogs, setBlogs] = useState<BlogSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [myBlog, setMyBlog] = useState<{ slug: string } | null | undefined>(undefined);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    fetch("/api/blogs/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setMyBlog(json?.data?.blog ?? null))
      .catch(() => setMyBlog(null));
  }, []);

  const buildUrl = useCallback((overCursor?: string | null) => {
    const p = new URLSearchParams({ tab });
    if (search.trim()) p.set("q", search.trim());
    if (overCursor) p.set("cursor", overCursor);
    return `/api/blogs?${p.toString()}`;
  }, [tab, search]);

  const cursorRef = useRef<string | null>(null);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);

  const fetchBlogs = useCallback(async (reset = true) => {
    if (reset) { setLoading(true); setCursor(null); }
    else setLoadingMore(true);
    try {
      const url = reset ? buildUrl(null) : buildUrl(cursorRef.current);
      const res = await fetch(url, { credentials: "include" });
      const body = await res.json();
      const data = body?.data;
      const newBlogs: BlogSummary[] = data?.blogs ?? [];
      setBlogs(reset ? newBlogs : (prev) => [...prev, ...newBlogs]);
      setCursor(data?.nextCursor ?? null);
      setHasMore(data?.hasMore ?? false);
    } catch { /* ignore */ } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [buildUrl]);

  useEffect(() => { void fetchBlogs(true); }, [tab, search]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t("blogs.title", "Blogs")}</h1>
        {myBlog !== undefined && (
          <Link
            href={myBlog ? "/blogs/dashboard" : "/blogs/new"}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            {myBlog ? t("blogs.myDashboard", "My Blog Dashboard") : t("blogs.startBlog", "Start a Blog")}
          </Link>
        )}
      </div>

      <div className="relative mb-4">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("blogs.search.placeholder", "Search blogs…")}
          className="w-full rounded-xl border border-border bg-card py-2.5 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="flex gap-1 mb-4 overflow-x-auto bg-neutral-900/50 rounded-xl p-1">
        {TABS.map(({ key, icon, labelKey, fallback }) => (
          <button
            key={key}
            type="button"
            onClick={() => { setTab(key); setBlogs([]); setCursor(null); }}
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
      ) : blogs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <div className="text-4xl mb-3">📝</div>
          <p>
            {search.trim()
              ? t("blogs.empty.search", "No blogs found for \"{{query}}\".", { query: search.trim() })
              : tab === "subscribed"
              ? t("blogs.subscribed.empty", "You haven't subscribed to any blogs yet.")
              : t("blogs.empty", "No blogs yet — be the first to start one.")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {blogs.map((b) => <BlogCard key={b.slug} b={b} />)}
        </div>
      )}

      {hasMore && !loading && (
        <div className="flex justify-center mt-6">
          <button
            type="button"
            onClick={() => void fetchBlogs(false)}
            disabled={loadingMore}
            className="px-6 py-3 rounded-xl border border-border bg-card text-sm font-semibold text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
          >
            {loadingMore ? t("blogs.loading", "Loading…") : t("blogs.loadMore", "Load more")}
          </button>
        </div>
      )}
    </div>
  );
}
