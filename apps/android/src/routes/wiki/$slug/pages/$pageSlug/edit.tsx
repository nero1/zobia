/**
 * apps/android/src/routes/wiki/$slug/pages/$pageSlug/edit.tsx
 *
 * Edit an existing wiki page — same WikiPageEditor as pages/new.tsx, seeded
 * from the current content, plus an edit-summary field (creates a new
 * revision server-side per PATCH /wiki/:slug/pages/:pageSlug).
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { fetchWikiPage } from '@/lib/wiki/api';
import { WikiPageEditor } from '@/components/wiki/WikiPageEditor';
import type { ContentFormat } from '@/components/wiki/types';

function EditWikiPagePage() {
  const { slug, pageSlug } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const pageQuery = useQuery({ queryKey: ['wiki', 'page', slug, pageSlug], queryFn: () => fetchWikiPage(slug, pageSlug) });

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [format, setFormat] = useState<ContentFormat>('markdown');
  const [editSummary, setEditSummary] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = pageQuery.data?.page;
    if (!p) return;
    setTitle(p.title);
    setContent(p.content_markdown);
    setFormat(p.content_format);
  }, [pageQuery.data]);

  const save = useMutation({
    mutationFn: () =>
      apiClient.patch(`/wiki/${slug}/pages/${pageSlug}`, {
        title: title.trim(),
        contentMarkdown: content.trim(),
        contentFormat: format,
        editSummary: editSummary.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki', 'page', slug, pageSlug] });
      qc.invalidateQueries({ queryKey: ['wiki', 'pages', slug] });
      navigate({ to: '/wiki/$slug/pages/$pageSlug', params: { slug, pageSlug } });
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      setError(e?.response?.data?.error?.message ?? t('error.generic'));
    },
  });

  if (pageQuery.isPending) return <div className="h-full overflow-y-auto bg-neutral-50 p-4"><div className="h-24 rounded bg-neutral-200 animate-pulse" /></div>;
  if (!pageQuery.data?.canContribute) {
    return <div className="h-full overflow-y-auto bg-neutral-50 p-6 text-center text-sm text-neutral-500">{t('wiki.pages.editNotAllowed', "You don't have permission to edit this page.")}</div>;
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <h1 className="text-lg font-bold text-neutral-900 mb-4">{t('wiki.pages.edit.title', 'Edit page')}</h1>
      <WikiPageEditor
        title={title}
        onTitleChange={setTitle}
        content={content}
        onContentChange={setContent}
        format={format}
        onFormatChange={setFormat}
        editSummary={editSummary}
        onEditSummaryChange={setEditSummary}
        showEditSummary
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button
        disabled={!title.trim() || !content.trim() || save.isPending}
        onClick={() => save.mutate()}
        className="mt-3 w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {save.isPending ? t('wiki.pages.edit.saving', 'Saving…') : t('wiki.pages.edit.save', 'Save changes')}
      </button>
    </div>
  );
}

export const Route = createFileRoute('/wiki/$slug/pages/$pageSlug/edit')({
  component: EditWikiPagePage,
});
