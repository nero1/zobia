"use client";

/**
 * app/(app)/wiki/[slug]/page.tsx
 *
 * Authenticated in-app wiki view: header (name/description/stats), a
 * searchable/paginated list of pages, a "New page" CTA for eligible
 * contributors, a "Manage" link for owners/moderators, and a Share button
 * (POST /api/wiki/<slug>/share — records a share + attempts a reward
 * claim). Logged-out visitors are served by the separate public SSR pages
 * at app/w/[slug].
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";

interface WikiDetail {
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

interface WikiPageSummary {
  id: string;
  slug: string;
  title: string;
  revision_count: number;
  view_count: number;
  updated_at: string;
}

export default function WikiHomePage() {
  const { t } = useTranslation();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [wiki, setWiki] = useState<WikiDetail | null | undefined>(undefined);
  const [canManage, setCanManage] = useState(false);
  const [canContribute, setCanContribute] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    fetch(`/api/wiki/${slug}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        setWiki(json?.data?.wiki ?? null);
        setCanManage(!!json?.data?.canManage);
        setCanContribute(!!json?.data?.canContribute);
      })
      .catch(() => setWiki(null));
  }, [slug]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const cursorRef = useRef<string | null>(null);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);

  const buildUrl = useCallback((overCursor?: string | null) => {
    const p = new URLSearchParams({ limit: "30" });
    if (search.trim()) p.set("q", search.trim());
    if (overCursor) p.set("cursor", overCursor);
    return `/api/wiki/${slug}/pages?${p.toString()}`;
  }, [slug, search]);

  const fetchPages = useCallback(async (reset = true) => {
    if (reset) { setLoading(true); setCursor(null); }
    else setLoadingMore(true);
    try {
      const url = reset ? buildUrl(null) : buildUrl(cursorRef.current);
      const res = await fetch(url, { credentials: "include" });
      const body = await res.json();
      const data = body?.data;
      const newPages: WikiPageSummary[] = data?.pages ?? [];
      setPages(reset ? newPages : (prev) => [...prev, ...newPages]);
      setCursor(data?.nextCursor ?? null);
      setHasMore(data?.hasMore ?? false);
    } catch { /* ignore */ } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [buildUrl]);

  useEffect(() => { void fetchPages(true); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleShare() {
    setSharing(true);
    try {
      await fetch(`/api/wiki/${slug}/share`, { method: "POST", credentials: "include" });
      setShared(true);
      if (navigator.share) {
        await navigator.share({ title: wiki?.name, url: `${window.location.origin}/wiki/${slug}` }).catch(() => {});
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${window.location.origin}/wiki/${slug}`).catch(() => {});
      }
    } catch { /* ignore */ } finally {
      setSharing(false);
    }
  }

  if (wiki === undefined) return <div className="mx-auto max-w-3xl px-4 py-8 text-muted-foreground">{t("wiki.loading", "Loading…")}</div>;
  if (wiki === null) return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-muted-foreground">{t("wiki.notFound", "Wiki not found.")}</div>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {wiki.cover_image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={wiki.cover_image_url} alt={wiki.name} className="mb-4 h-32 w-full rounded-2xl object-cover" />
      )}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{wiki.name}</h1>
          {wiki.description && <p className="text-sm text-muted-foreground mt-1">{wiki.description}</p>}
          {wiki.owner_username && (
            <p className="text-xs text-muted-foreground mt-1">{t("wiki.ownedBy", "Owned by @{{username}}", { username: wiki.owner_username })}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {t("wiki.card.pages", "{{count}} pages", { count: wiki.page_count })} · {t("wiki.card.contributors", "{{count}} contributors", { count: wiki.contributor_count })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleShare}
            disabled={sharing}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            {shared ? t("wiki.shared", "Shared ✓") : t("wiki.share", "Share")}
          </button>
          {canManage && (
            <Link href={`/wiki/${slug}/manage`} className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent">
              {t("wiki.manage", "Manage")}
            </Link>
          )}
          {canContribute && (
            <Link href={`/wiki/${slug}/new`} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
              {t("wiki.newPage", "+ New page")}
            </Link>
          )}
        </div>
      </div>

      <div className="relative mb-4">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("wiki.page.search.placeholder", "Search pages…")}
          className="w-full rounded-xl border border-border bg-card py-2.5 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 rounded-xl bg-neutral-800 animate-pulse" />)}</div>
      ) : pages.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          {search.trim()
            ? t("wiki.page.empty.search", "No pages found for \"{{query}}\".", { query: search.trim() })
            : t("wiki.page.empty", "No pages yet.")}
        </div>
      ) : (
        <div className="space-y-2">
          {pages.map((p) => (
            <Link
              key={p.id}
              href={`/wiki/${slug}/${p.slug}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 hover:border-primary/60 transition-colors"
            >
              <div className="min-w-0">
                <div className="font-medium text-foreground text-sm truncate">{p.title}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {t("wiki.page.revisionCount", "{{count}} revisions", { count: p.revision_count })} · {t("wiki.page.viewCount", "{{count}} views", { count: p.view_count })}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {hasMore && !loading && (
        <div className="flex justify-center mt-6">
          <button
            type="button"
            onClick={() => void fetchPages(false)}
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
