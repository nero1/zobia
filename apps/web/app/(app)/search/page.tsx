"use client";

/**
 * app/(app)/search/page.tsx
 *
 * Universal sitewide search results page — GET /api/search under the hood.
 * State (query, selected categories, date range, how many results are
 * loaded) lives in the URL query string so a search is shareable/bookmarkable
 * and survives a refresh, matching the pattern other list pages in this app
 * use for their own filters.
 *
 * Ad placements (search_top / search_after_3 / search_after_8 /
 * search_bottom — see db/migrations/0011_search_ad_placements.sql) reuse the
 * existing <AdSlot/> component, which already enforces per-plan ad
 * visibility server-side — this page does no ad-eligibility logic of its own.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import AdSlot from "@/components/ads/AdSlot";
import { authFetch } from "@/lib/api/authFetch";

// Kept in sync with app/api/search/route.ts's own definitions — not imported
// directly from there to avoid pulling a server route module into the client
// bundle graph.
type SearchContentType = "people" | "blogs" | "wikis" | "answers" | "games";
type SearchDateRange = "week" | "month" | "quarter" | "year" | "all";

interface SearchResult {
  type: SearchContentType;
  id: string;
  title: string;
  snippet: string | null;
  thumbnail_url: string | null;
  url: string;
  published_at: string;
}

const ALL_TYPES: SearchContentType[] = ["people", "blogs", "wikis", "answers", "games"];
const TYPE_ICON: Record<SearchContentType, string> = {
  people: "👤",
  blogs: "✍️",
  wikis: "📖",
  answers: "❓",
  games: "🎮",
};
const RANGES: SearchDateRange[] = ["week", "month", "quarter", "year", "all"];

function parseTypes(param: string | null): SearchContentType[] {
  if (!param) return ALL_TYPES;
  const parsed = param.split(",").filter((t): t is SearchContentType => (ALL_TYPES as string[]).includes(t));
  return parsed.length > 0 ? parsed : ALL_TYPES;
}

export default function SearchPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlQ = searchParams?.get("q") ?? "";
  const urlTypes = parseTypes(searchParams?.get("types") ?? null);
  const urlRange = (searchParams?.get("range") as SearchDateRange | null) ?? "all";

  const [qInput, setQInput] = useState(urlQ);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => setQInput(urlQ), [urlQ]);

  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      append ? setLoadingMore(true) : setLoading(true);
      setError(false);
      try {
        const params = new URLSearchParams();
        if (urlQ) params.set("q", urlQ);
        params.set("types", urlTypes.join(","));
        params.set("range", urlRange);
        params.set("offset", String(offset));
        const res = await authFetch(`/api/search?${params.toString()}`);
        if (!res.ok) throw new Error("search failed");
        const body = (await res.json()) as {
          data: { results: SearchResult[]; hasMore: boolean; nextOffset: number | null };
        };
        setResults((prev) => (append ? [...prev, ...body.data.results] : body.data.results));
        setHasMore(body.data.hasMore);
        setNextOffset(body.data.nextOffset);
      } catch {
        setError(true);
      } finally {
        append ? setLoadingMore(false) : setLoading(false);
      }
    },
    [urlQ, urlTypes, urlRange]
  );

  useEffect(() => {
    fetchPage(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ, urlRange, JSON.stringify(urlTypes)]);

  function updateUrl(next: { q?: string; types?: SearchContentType[]; range?: SearchDateRange }) {
    const params = new URLSearchParams();
    const q = next.q ?? urlQ;
    const types = next.types ?? urlTypes;
    const range = next.range ?? urlRange;
    if (q) params.set("q", q);
    if (types.length !== ALL_TYPES.length) params.set("types", types.join(","));
    if (range !== "all") params.set("range", range);
    router.push(`/search${params.toString() ? `?${params.toString()}` : ""}`);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    updateUrl({ q: qInput.trim() });
  }

  function toggleType(type: SearchContentType) {
    const next = urlTypes.includes(type) ? urlTypes.filter((tt) => tt !== type) : [...urlTypes, type];
    updateUrl({ types: next.length > 0 ? next : ALL_TYPES });
  }

  const resultItems = useMemo(
    () =>
      results.map((r, i) => (
        <div key={`${r.type}:${r.id}`}>
          <Link
            href={r.url}
            className="flex gap-3 rounded-xl border border-neutral-200 p-3 transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            {r.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.thumbnail_url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-2xl dark:bg-neutral-800">
                {TYPE_ICON[r.type]}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400">
                  {t(`search.category.${r.type}`)}
                </span>
              </div>
              <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-50">{r.title}</p>
              {r.snippet && (
                <p className="line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">{r.snippet}</p>
              )}
            </div>
          </Link>
          {i === 2 && <AdSlot placement="search_after_3" className="mt-3" />}
          {i === 7 && <AdSlot placement="search_after_8" className="mt-3" />}
        </div>
      )),
    [results, t]
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">{t("search.title")}</h1>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="flex gap-2">
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder={t("search.placeholder")}
            className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
            className="rounded-xl border border-neutral-300 px-3 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {t("search.advanced")}
          </button>
          <button
            type="submit"
            className="rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
          >
            {t("search.submit")}
          </button>
        </div>

        {advancedOpen && (
          <div className="space-y-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                {t("search.categories")}
              </p>
              <div className="flex flex-wrap gap-2">
                {ALL_TYPES.map((type) => (
                  <label
                    key={type}
                    className="flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
                  >
                    <input
                      type="checkbox"
                      checked={urlTypes.includes(type)}
                      onChange={() => toggleType(type)}
                      className="h-3.5 w-3.5"
                    />
                    {TYPE_ICON[type]} {t(`search.category.${type}`)}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                {t("search.datePublished")}
              </label>
              <select
                value={urlRange}
                onChange={(e) => updateUrl({ range: e.target.value as SearchDateRange })}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              >
                {RANGES.map((r) => (
                  <option key={r} value={r}>
                    {t(`search.range.${r}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </form>

      <AdSlot placement="search_top" />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
          ))}
        </div>
      ) : error ? (
        <p className="text-center text-sm text-neutral-500 dark:text-neutral-400">{t("search.error")}</p>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-10 text-center dark:border-neutral-700 dark:bg-neutral-900">
          <div className="mb-2 text-3xl">🔍</div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t("search.noResults")}</p>
        </div>
      ) : (
        <div className="space-y-3">{resultItems}</div>
      )}

      {hasMore && nextOffset != null && !loading && (
        <button
          onClick={() => fetchPage(nextOffset, true)}
          disabled={loadingMore}
          className="w-full rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {loadingMore ? t("search.loadingMore") : t("search.loadMore")}
        </button>
      )}

      {!loading && !hasMore && results.length > 0 && <AdSlot placement="search_bottom" />}
    </div>
  );
}
