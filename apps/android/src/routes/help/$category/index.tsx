/**
 * apps/android/src/routes/help/$category.tsx
 *
 * Help Center category page — mirrors apps/web/app/help/[category]/page.tsx.
 */

import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface Doc {
  id: string;
  slug: string;
  title: string;
  difficulty: 'first_time' | 'beginner' | 'intermediate' | 'advanced';
}

interface CategoryResponse {
  category: { slug: string; name: string; description: string | null };
  docs: Doc[];
}

function HelpCategoryPage() {
  const { t } = useTranslation();
  const { category } = Route.useParams();
  const { data } = useQuery({
    queryKey: ['help', 'category', category],
    queryFn: async () => (await apiClient.get<CategoryResponse>(`/help/categories/${category}`)).data,
  });

  if (!data) return <div className="p-4"><div className="h-40 animate-pulse rounded-xl bg-neutral-800" /></div>;

  return (
    <div className="p-4">
      <Link to="/help" className="text-sm text-primary-400 underline">&larr; {t('help.homeTitle', 'Help Center')}</Link>
      <h1 className="mt-2 mb-1 text-xl font-bold text-white">{data.category.name}</h1>
      {data.category.description && <p className="mb-4 text-sm text-neutral-400">{data.category.description}</p>}

      <div className="space-y-2">
        {data.docs.map((doc) => (
          <Link key={doc.id} to="/help/$category/$doc" params={{ category: data.category.slug, doc: doc.slug }} className="block rounded-xl border border-neutral-800 bg-neutral-900 p-3">
            <p className="font-medium text-white">{doc.title}</p>
            <p className="text-xs text-neutral-500">{t(`help.difficulty.${doc.difficulty}`, doc.difficulty)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/help/$category/')({
  component: HelpCategoryPage,
});
