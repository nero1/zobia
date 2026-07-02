/**
 * apps/android/src/routes/blogs/new.tsx
 *
 * Create the caller's blog — mirrors apps/web/app/(app)/blogs/new/page.tsx.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

function NewBlogPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [tagline, setTagline] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createBlog = useMutation({
    mutationFn: () => apiClient.post<{ data: { slug: string } }>('/blogs', { title, tagline: tagline || undefined }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['blogs', 'me'] });
      navigate({ to: '/blogs/$slug', params: { slug: res.data.data.slug } });
    },
    onError: () => setError(t('error.generic')),
  });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <h1 className="text-lg font-bold text-neutral-900 mb-4">{t('blogs.new.title', 'Start a Blog')}</h1>
      <div className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          placeholder={t('blogs.new.titlePlaceholder', "e.g. Muna's World")}
          className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none"
        />
        <input
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
          maxLength={160}
          placeholder={t('blogs.new.taglineLabel', 'Tagline (optional)')}
          className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          disabled={!title.trim() || createBlog.isPending}
          onClick={() => createBlog.mutate()}
          className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {createBlog.isPending ? t('blogs.new.creating', 'Creating…') : t('blogs.new.create', 'Create blog')}
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/blogs/new')({
  component: NewBlogPage,
});
