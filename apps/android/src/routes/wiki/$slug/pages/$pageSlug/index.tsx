/**
 * apps/android/src/routes/wiki/$slug/pages/$pageSlug/index.tsx
 *
 * Page view — renders the server-sanitized content_html (same pattern as
 * routes/blogs/$slug/$postSlug.tsx's dangerouslySetInnerHTML render), plus
 * edit/revisions/delete links for eligible contributors/managers.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { fetchWikiPage } from '@/lib/wiki/api';
import { formatShortDate } from '@/lib/format/date';

function WikiPageViewPage() {
  const { slug, pageSlug } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const pageQuery = useQuery({
    queryKey: ['wiki', 'page', slug, pageSlug],
    queryFn: () => fetchWikiPage(slug, pageSlug),
  });

  const deletePage = useMutation({
    mutationFn: () => apiClient.delete(`/wiki/${slug}/pages/${pageSlug}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki', 'pages', slug] });
      navigate({ to: '/wiki/$slug', params: { slug } });
    },
  });

  if (pageQuery.isPending) return <div className="h-full overflow-y-auto bg-neutral-50 p-4"><div className="h-24 rounded bg-neutral-200 animate-pulse" /></div>;
  if (!pageQuery.data) return <div className="h-full overflow-y-auto bg-neutral-50 p-6 text-center text-sm text-neutral-500">{t('wiki.pages.notFound', 'Page not found.')}</div>;

  const { page, canManage, canContribute } = pageQuery.data;

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-lg font-bold text-neutral-900">{page.title}</h1>
          <Link to="/wiki/$slug" params={{ slug }} className="flex-shrink-0 text-xs text-neutral-400 underline underline-offset-2">
            {t('wiki.pages.backToWiki', 'Back')}
          </Link>
        </div>
        <p className="text-xs text-neutral-400 mt-1">
          {t('wiki.pages.byLine', 'By {{creator}} · updated {{date}}', {
            creator: page.creator_username ? `@${page.creator_username}` : t('wiki.pages.unknownAuthor', 'someone'),
            date: formatShortDate(page.updated_at),
          })}
        </p>

        {page.content_format === 'plaintext' ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-800">{page.content_markdown}</p>
        ) : (
          // Server-sanitized HTML — safe to render (mirrors blogs' post body render).
          <div className="prose prose-sm mt-3" dangerouslySetInnerHTML={{ __html: page.content_html }} />
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3">
          {canContribute && (
            <Link to="/wiki/$slug/pages/$pageSlug/edit" params={{ slug, pageSlug }} className="rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-700">
              {t('wiki.pages.edit', 'Edit')}
            </Link>
          )}
          <Link to="/wiki/$slug/pages/$pageSlug/revisions" params={{ slug, pageSlug }} className="rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-700">
            {t('wiki.pages.viewHistory', 'History ({{count}})', { count: page.revision_count })}
          </Link>
          {canManage && !confirmingDelete && (
            <button onClick={() => setConfirmingDelete(true)} className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-700">
              {t('common.delete', 'Delete')}
            </button>
          )}
          {canManage && confirmingDelete && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-700">{t('wiki.pages.confirmDelete', 'Delete this page?')}</span>
              <button disabled={deletePage.isPending} onClick={() => deletePage.mutate()} className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
                {t('common.delete', 'Delete')}
              </button>
              <button onClick={() => setConfirmingDelete(false)} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700">
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/wiki/$slug/pages/$pageSlug/')({
  component: WikiPageViewPage,
});
