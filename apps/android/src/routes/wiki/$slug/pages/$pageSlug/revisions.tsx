/**
 * apps/android/src/routes/wiki/$slug/pages/$pageSlug/revisions.tsx
 *
 * Revision history — newest first, with a restore action for eligible
 * contributors (POST .../revisions { revisionNumber } creates a new
 * revision copying the old content, per the backend contract).
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { fetchPageRevisions, fetchWikiPage } from '@/lib/wiki/api';
import { formatShortDate } from '@/lib/format/date';

function WikiPageRevisionsPage() {
  const { slug, pageSlug } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [restoringNumber, setRestoringNumber] = useState<number | null>(null);

  const pageQuery = useQuery({ queryKey: ['wiki', 'page', slug, pageSlug], queryFn: () => fetchWikiPage(slug, pageSlug) });
  const revisionsQuery = useQuery({ queryKey: ['wiki', 'revisions', slug, pageSlug], queryFn: () => fetchPageRevisions(slug, pageSlug) });

  const restore = useMutation({
    mutationFn: (revisionNumber: number) => apiClient.post(`/wiki/${slug}/pages/${pageSlug}/revisions`, { revisionNumber }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki', 'page', slug, pageSlug] });
      qc.invalidateQueries({ queryKey: ['wiki', 'revisions', slug, pageSlug] });
      navigate({ to: '/wiki/$slug/pages/$pageSlug', params: { slug, pageSlug } });
    },
    onSettled: () => setRestoringNumber(null),
  });

  const canContribute = pageQuery.data?.canContribute ?? false;

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-3">
      <h1 className="text-lg font-bold text-neutral-900">{t('wiki.revisions.title', 'Revision history')}</h1>

      {revisionsQuery.isPending ? (
        <div className="h-16 rounded bg-neutral-200 animate-pulse" />
      ) : (revisionsQuery.data ?? []).length === 0 ? (
        <p className="text-sm text-neutral-500 text-center py-10">{t('wiki.revisions.empty', 'No revisions yet.')}</p>
      ) : (
        <div className="space-y-1.5">
          {revisionsQuery.data!.map((r, i) => (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white p-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900">
                  {t('wiki.revisions.number', 'Revision #{{n}}', { n: r.revision_number })}
                  {i === 0 && <span className="ml-1.5 text-[10px] font-semibold uppercase text-primary-600">{t('wiki.revisions.current', 'Current')}</span>}
                </p>
                <p className="text-[11px] text-neutral-400">
                  {r.editor_username ? `@${r.editor_username}` : t('wiki.pages.unknownAuthor', 'someone')} · {formatShortDate(r.created_at)}
                  {r.edit_summary && ` · ${r.edit_summary}`}
                </p>
              </div>
              {canContribute && i !== 0 && (
                <button
                  disabled={restore.isPending}
                  onClick={() => { setRestoringNumber(r.revision_number); restore.mutate(r.revision_number); }}
                  className="flex-shrink-0 rounded-lg bg-neutral-100 px-2.5 py-1.5 text-xs font-semibold text-neutral-700 disabled:opacity-50"
                >
                  {restoringNumber === r.revision_number ? t('wiki.revisions.restoring', 'Restoring…') : t('wiki.revisions.restore', 'Restore')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/wiki/$slug/pages/$pageSlug/revisions')({
  component: WikiPageRevisionsPage,
});
