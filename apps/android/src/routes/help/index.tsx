/**
 * apps/android/src/routes/help/index.tsx
 *
 * Help Center homepage — mirrors apps/web/app/help/page.tsx's category grid.
 * Public — no auth required to browse (GET /api/help/categories).
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

function HelpHomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data } = useQuery({
    queryKey: ['help', 'categories'],
    queryFn: async () => (await apiClient.get<Category[]>('/help/categories')).data,
  });

  return (
    <div className="p-4">
      <h1 className="mb-4 text-xl font-bold text-white">{t('help.homeTitle', 'Help Center')}</h1>

      <form
        onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate({ to: '/help/search', search: { q: q.trim() } }); }}
        className="mb-6 flex gap-2"
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('help.searchPlaceholder', 'Search the Help Center…')} className="flex-1 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white" />
        <button type="submit" className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white">{t('help.search', 'Search')}</button>
      </form>

      <div className="grid gap-3">
        {(data ?? []).map((cat) => (
          <Link key={cat.id} to="/help/$category" params={{ category: cat.slug }} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <p className="font-semibold text-white">{cat.name}</p>
            {cat.description && <p className="mt-1 text-sm text-neutral-400">{cat.description}</p>}
          </Link>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/help/')({
  component: HelpHomePage,
});
