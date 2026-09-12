/**
 * apps/android/src/routes/wiki/$slug/pages/new.tsx
 *
 * Create a new wiki page — open to any eligible contributor (not just the
 * owner), unlike blogs' post creation which stayed web-only. Uses the shared
 * WikiPageEditor for the title/content/format fields.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { WikiPageEditor } from '@/components/wiki/WikiPageEditor';
import type { ContentFormat } from '@/components/wiki/types';

function NewWikiPagePage() {
  const { slug } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [format, setFormat] = useState<ContentFormat>('markdown');
  const [error, setError] = useState<string | null>(null);

  const createPage = useMutation({
    mutationFn: () =>
      apiClient.post<{ id: string; slug: string }>(`/wiki/${slug}/pages`, {
        title: title.trim(),
        contentMarkdown: content.trim(),
        contentFormat: format,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['wiki', 'pages', slug] });
      qc.invalidateQueries({ queryKey: ['wiki', 'detail', slug] });
      navigate({ to: '/wiki/$slug/pages/$pageSlug', params: { slug, pageSlug: res.data.slug } });
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      setError(e?.response?.data?.error?.message ?? t('error.generic'));
    },
  });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <h1 className="text-lg font-bold text-neutral-900 mb-4">{t('wiki.pages.new.title', 'New page')}</h1>
      <WikiPageEditor
        title={title}
        onTitleChange={setTitle}
        content={content}
        onContentChange={setContent}
        format={format}
        onFormatChange={setFormat}
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button
        disabled={!title.trim() || !content.trim() || createPage.isPending}
        onClick={() => createPage.mutate()}
        className="mt-3 w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {createPage.isPending ? t('wiki.pages.new.creating', 'Publishing…') : t('wiki.pages.new.create', 'Publish page')}
      </button>
    </div>
  );
}

export const Route = createFileRoute('/wiki/$slug/pages/new')({
  component: NewWikiPagePage,
});
