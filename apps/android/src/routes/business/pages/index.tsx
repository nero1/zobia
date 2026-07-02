/**
 * apps/android/src/routes/business/pages/index.tsx
 *
 * Business Pages list — mirrors apps/web/app/(app)/business/pages/page.tsx.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

interface BusinessPage {
  id: string;
  slug: string;
  name: string;
  status: string;
  view_count: number;
  post_count: number;
}

async function fetchPages() {
  const { data } = await apiClient.get<{ pages: BusinessPage[]; limit: number; used: number }>('/business/pages');
  return data;
}

function BusinessPagesList() {
  const qc = useQueryClient();
  const { data, status } = useQuery({ queryKey: ['business', 'pages'], queryFn: fetchPages, staleTime: 30_000 });
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (n: string) => apiClient.post('/business/pages', { name: n }),
    onSuccess: () => {
      setName('');
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ['business', 'pages'] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to create page'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/business/pages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['business', 'pages'] }),
  });

  if (status === 'pending') return <div className="p-6 text-center text-neutral-400">Loading…</div>;

  const pages = data?.pages ?? [];
  const limit = data?.limit ?? 0;
  const used = data?.used ?? 0;
  const atLimit = used >= limit;

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold text-neutral-900">Business Pages</h1>
        <span className="text-xs text-neutral-500">{used}/{limit} slots</span>
      </div>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          disabled={atLimit}
          className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40 mb-4"
        >
          + New Page
        </button>
      ) : (
        <div className="bg-white rounded-xl p-4 shadow-card mb-4 space-y-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Page name"
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm">Cancel</button>
            <button
              onClick={() => name.trim() && createMutation.mutate(name.trim())}
              disabled={createMutation.isPending || !name.trim()}
              className="flex-1 rounded-lg bg-primary-600 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {createMutation.isPending ? '…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {pages.length === 0 ? (
        <p className="text-center text-sm text-neutral-400 py-10">No Business Pages yet.</p>
      ) : (
        <div className="space-y-2">
          {pages.map((p) => (
            <div key={p.id} className="bg-white rounded-xl p-4 shadow-card flex items-center justify-between">
              <Link to="/business/pages/$pageId" params={{ pageId: p.id }} className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-neutral-900 truncate">{p.name}</p>
                <p className="text-xs text-neutral-400">👁 {p.view_count} · 📝 {p.post_count} · {p.status}</p>
              </Link>
              <button
                onClick={() => deleteMutation.mutate(p.id)}
                className="ml-2 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/business/pages/')({
  component: BusinessPagesList,
});
