/**
 * apps/android/src/routes/help/search.tsx
 *
 * Help Center search results — mirrors apps/web/app/help/search/page.tsx.
 * GET /api/help/search?q=...
 */

import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface SearchResult {
  id: string;
  slug: string;
  title: string;
  category_slug: string;
  snippet: string;
}

function HelpSearchPage() {
  const { t } = useTranslation();
  const { q } = Route.useSearch();
  const { data } = useQuery({
    queryKey: ['help', 'search', q],
    queryFn: async () => (await apiClient.get<SearchResult[]>(`/help/search?q=${encodeURIComponent(q ?? '')}`)).data,
    enabled: !!q,
  });

  return (
    <div className="p-4">
      <Link to="/help" className="text-sm text-primary-400 underline">&larr; {t('help.homeTitle', 'Help Center')}</Link>
      <h1 className="mt-2 mb-4 text-lg font-bold text-white">{t('help.searchResults', 'Search results')}{q ? ` for "${q}"` : ''}</h1>

      {q && data && data.length === 0 && <p className="text-sm text-neutral-400">{t('help.noResults', 'No results found. Try a different search, or ask the AI on any doc page.')}</p>}

      <div className="space-y-2">
        {(data ?? []).map((r) => (
          <Link key={r.id} to="/help/$category/$doc" params={{ category: r.category_slug, doc: r.slug }} className="block rounded-xl border border-neutral-800 bg-neutral-900 p-3">
            <p className="font-medium text-white">{r.title}</p>
            <p className="mt-1 text-sm text-neutral-400" dangerouslySetInnerHTML={{ __html: r.snippet }} />
          </Link>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/help/search')({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === 'string' ? search.q : undefined,
  }),
  component: HelpSearchPage,
});
