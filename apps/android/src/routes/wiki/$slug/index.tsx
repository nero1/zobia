/**
 * apps/android/src/routes/wiki/$slug/index.tsx
 *
 * Wiki home — page list + search, "add page" CTA for eligible contributors,
 * owner/moderator toolbar. Mirrors routes/blogs/$slug/index.tsx's shape.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { fetchWiki, fetchWikiPages } from '@/lib/wiki/api';
import { WikiOwnerToolbar } from '@/components/wiki/WikiOwnerToolbar';
import { formatShortDate } from '@/lib/format/date';

function WikiHomePage() {
  const { slug } = Route.useParams();
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  const wikiQuery = useQuery({ queryKey: ['wiki', 'detail', slug], queryFn: () => fetchWiki(slug) });
  const pagesQuery = useQuery({ queryKey: ['wiki', 'pages', slug, search], queryFn: () => fetchWikiPages(slug, search) });

  const wiki = wikiQuery.data?.wiki;
  const isOwner = wikiQuery.data?.isOwner ?? false;
  const canManage = wikiQuery.data?.canManage ?? false;
  const canContribute = wikiQuery.data?.canContribute ?? false;

  if (wikiQuery.isPending) return <div className="h-full overflow-y-auto bg-neutral-50 p-4"><div className="h-24 rounded bg-neutral-200 animate-pulse" /></div>;
  if (!wiki) return <div className="h-full overflow-y-auto bg-neutral-50 p-6 text-center text-sm text-neutral-500">{t('wiki.notFound', 'Wiki not found.')}</div>;

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-4">
      {canManage && <WikiOwnerToolbar wikiSlug={slug} isOwner={isOwner} />}

      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-neutral-100 text-2xl">
            {wiki.avatar_url ? <img src={wiki.avatar_url} alt="" className="h-full w-full object-cover" /> : '📖'}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-neutral-900 truncate">{wiki.name}</h1>
            {wiki.description && <p className="text-sm text-neutral-500 mt-0.5 line-clamp-2">{wiki.description}</p>}
            <p className="text-xs text-neutral-400 mt-1">@{wiki.owner_username}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
          <span>{t('wiki.stat.pages', '{{count}} pages', { count: wiki.page_count })}</span>
          <span>{t('wiki.stat.contributors', '{{count}} contributors', { count: wiki.contributor_count })}</span>
          <span>👁 {wiki.view_count}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('wiki.pages.searchPlaceholder', 'Search pages…')}
          className="flex-1 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none"
        />
        {canContribute && (
          <Link
            to="/wiki/$slug/pages/new"
            params={{ slug }}
            className="flex-shrink-0 rounded-xl bg-primary-600 px-3 py-2.5 text-xs font-semibold text-white"
          >
            {t('wiki.pages.addPage', '+ Page')}
          </Link>
        )}
      </div>

      {pagesQuery.isPending ? (
        <div className="h-16 rounded bg-neutral-200 animate-pulse" />
      ) : (pagesQuery.data?.pages.length ?? 0) === 0 ? (
        <p className="text-sm text-neutral-500 text-center py-10">{t('wiki.pages.empty', 'No pages yet.')}</p>
      ) : (
        <div className="space-y-2">
          {pagesQuery.data!.pages.map((p) => (
            <Link
              key={p.id}
              to="/wiki/$slug/pages/$pageSlug"
              params={{ slug, pageSlug: p.slug }}
              className="block rounded-xl border border-neutral-200 bg-white p-3"
            >
              <h2 className="font-semibold text-sm text-neutral-900">{p.title}</h2>
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-neutral-400">
                <span>{formatShortDate(p.updated_at)}</span>
                <span>👁 {p.view_count}</span>
                <span>{t('wiki.pages.revisionCount', '{{count}} edits', { count: p.revision_count })}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/wiki/$slug/')({
  component: WikiHomePage,
});
