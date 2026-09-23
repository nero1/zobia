/**
 * apps/android/src/routes/search.tsx
 *
 * Universal sitewide search — mirrors apps/web/app/(app)/search/page.tsx.
 * GET /api/search under the hood (same endpoint the web app calls), so
 * behaviour (categories, date range, ad placements) stays identical across
 * web/PWA and this Capacitor app.
 */

import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import AdSlot from '@/components/ads/AdSlot';

type SearchContentType = 'people' | 'blogs' | 'wikis' | 'answers' | 'games';
type SearchDateRange = 'week' | 'month' | 'quarter' | 'year' | 'all';

interface SearchResult {
  type: SearchContentType;
  id: string;
  title: string;
  snippet: string | null;
  thumbnail_url: string | null;
  url: string;
  published_at: string;
}

const ALL_TYPES: SearchContentType[] = ['people', 'blogs', 'wikis', 'answers', 'games'];
const TYPE_ICON: Record<SearchContentType, string> = {
  people: '👤',
  blogs: '✍️',
  wikis: '📖',
  answers: '❓',
  games: '🎮',
};
const RANGES: SearchDateRange[] = ['week', 'month', 'quarter', 'year', 'all'];

/**
 * The API's `url` field is the web app's short SEO path (/u/<username>,
 * /b/<blogSlug>/<postSlug>, /w/<wikiSlug>/<pageSlug>, /a/<slug>, /g/<slug>) —
 * this app doesn't have those short public routes, it uses its own longer
 * ones (see src/routes/profile/$username.tsx, blog-posts/$id.tsx,
 * wiki-pages/$id.tsx, answers/$questionId.tsx, games/$slug/index.tsx).
 * Blogs/wikis/answers key off `r.id` directly (already the right id for
 * those routes); people/games key off the last `url` segment (username /
 * slug respectively — not `r.id`, which is a uuid neither route accepts).
 */
function resultLinkProps(r: SearchResult): { to: string; params: Record<string, string> } {
  const lastSegment = r.url.slice(r.url.lastIndexOf('/') + 1);
  switch (r.type) {
    case 'people':
      return { to: '/profile/$username', params: { username: lastSegment } };
    case 'blogs':
      return { to: '/blog-posts/$id', params: { id: r.id } };
    case 'wikis':
      return { to: '/wiki-pages/$id', params: { id: r.id } };
    case 'answers':
      return { to: '/answers/$questionId', params: { questionId: r.id } };
    case 'games':
      return { to: '/games/$slug', params: { slug: lastSegment } };
  }
}

async function fetchSearch(q: string, types: SearchContentType[], range: SearchDateRange, offset: number) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('types', types.join(','));
  params.set('range', range);
  params.set('offset', String(offset));
  const { data } = await apiClient.get<{ results: SearchResult[]; hasMore: boolean; nextOffset: number | null }>(
    `/search?${params.toString()}`
  );
  return data;
}

function SearchPage() {
  const { t } = useTranslation();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [types, setTypes] = useState<SearchContentType[]>(ALL_TYPES);
  const [range, setRange] = useState<SearchDateRange>('all');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [offset, setOffset] = useState(0);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['search', q, types.join(','), range, offset],
    queryFn: () => fetchSearch(q, types, range, offset),
  });

  // Filters/query changed — start a fresh list from page 0.
  useEffect(() => {
    setResults([]);
    setOffset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, types.join(','), range]);

  // New page arrived — append (offset > 0) or replace (offset === 0, e.g.
  // a fresh search) with this page's results.
  useEffect(() => {
    if (!data) return;
    setResults((prev) => (offset === 0 ? data.results : [...prev, ...data.results]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  function toggleType(type: SearchContentType) {
    const next = types.includes(type) ? types.filter((tt) => tt !== type) : [...types, type];
    setTypes(next.length > 0 ? next : ALL_TYPES);
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex gap-2">
        <input
          type="search"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setQ(qInput.trim());
              setOffset(0);
            }
          }}
          placeholder={t('search.placeholder')}
          className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="rounded-xl border border-neutral-300 px-3 py-2.5 text-sm font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
        >
          {t('search.advanced')}
        </button>
        <button
          type="button"
          onClick={() => {
            setQ(qInput.trim());
            setOffset(0);
          }}
          className="rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white"
        >
          {t('search.submit')}
        </button>
      </div>

      {advancedOpen && (
        <div className="space-y-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400">{t('search.categories')}</p>
            <div className="flex flex-wrap gap-2">
              {ALL_TYPES.map((type) => (
                <label
                  key={type}
                  className="flex items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
                >
                  <input type="checkbox" checked={types.includes(type)} onChange={() => toggleType(type)} className="h-3.5 w-3.5" />
                  {TYPE_ICON[type]} {t(`search.category.${type}`)}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-neutral-500 dark:text-neutral-400">
              {t('search.datePublished')}
            </label>
            <select
              value={range}
              onChange={(e) => {
                setRange(e.target.value as SearchDateRange);
                setOffset(0);
              }}
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

      <AdSlot placement="search_top" />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
          ))}
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-10 text-center dark:border-neutral-700 dark:bg-neutral-900">
          <div className="mb-2 text-3xl">🔍</div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('search.noResults')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {results.map((r, i) => (
            <div key={`${r.type}:${r.id}`}>
              <Link
                // Search results span five different destination route
                // shapes (see resultLinkProps) — narrower than the
                // router's generated literal `to` union, so this is cast
                // rather than fought.
                {...(resultLinkProps(r) as Record<string, unknown> as any)}
                className="flex gap-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
              >
                {r.thumbnail_url ? (
                  <img src={r.thumbnail_url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-2xl dark:bg-neutral-800">
                    {TYPE_ICON[r.type]}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-400">
                    {t(`search.category.${r.type}`)}
                  </span>
                  <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-50">{r.title}</p>
                  {r.snippet && <p className="line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">{r.snippet}</p>}
                </div>
              </Link>
              {i === 2 && <AdSlot placement="search_after_3" className="mt-3" />}
              {i === 7 && <AdSlot placement="search_after_8" className="mt-3" />}
            </div>
          ))}
        </div>
      )}

      {data?.hasMore && data.nextOffset != null && !isLoading && (
        <button
          onClick={() => setOffset(data.nextOffset as number)}
          disabled={isFetching}
          className="w-full rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300"
        >
          {isFetching ? t('search.loadingMore') : t('search.loadMore')}
        </button>
      )}

      {!isLoading && !data?.hasMore && results.length > 0 && <AdSlot placement="search_bottom" />}
    </div>
  );
}

export const Route = createFileRoute('/search')({
  component: SearchPage,
});
