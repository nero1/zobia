/**
 * apps/android/src/routes/business/pages/$pageId.tsx
 *
 * Single Business Page: profile + posts ("post stuff" — PRD §17). Mirrors
 * apps/web/app/(app)/business/pages/[pageId]/page.tsx at Android's leaner
 * scope (no inline profile editing — that stays web/PWA, same convention
 * as Blogs settings).
 */

import { useState } from 'react';
import { createFileRoute, useParams } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

interface BusinessPage {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
}

interface Post {
  id: string;
  title: string;
  body: string;
  view_count: number;
  created_at: string;
}

async function fetchPageDetail(pageId: string) {
  const { data } = await apiClient.get<{ page: BusinessPage; posts: Post[] }>(`/business/pages/${pageId}`);
  return data;
}

function BusinessPageDetail() {
  const { pageId } = useParams({ from: '/business/pages/$pageId' });
  const qc = useQueryClient();
  const { data, status } = useQuery({ queryKey: ['business', 'pages', pageId], queryFn: () => fetchPageDetail(pageId) });
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const postMutation = useMutation({
    mutationFn: () => apiClient.post(`/business/pages/${pageId}/posts`, { title: title.trim(), body: body.trim(), status: 'published' }),
    onSuccess: () => {
      setTitle(''); setBody(''); setShowForm(false);
      qc.invalidateQueries({ queryKey: ['business', 'pages', pageId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (postId: string) => apiClient.delete(`/business/pages/${pageId}/posts/${postId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['business', 'pages', pageId] }),
  });

  if (status === 'pending') return <div className="p-6 text-center text-neutral-400">Loading…</div>;
  if (!data) return <div className="p-6 text-center text-neutral-400">Not found</div>;

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <h1 className="text-lg font-bold text-neutral-900">{data.page.name}</h1>
      {data.page.bio && <p className="text-sm text-neutral-500 mt-1">{data.page.bio}</p>}

      <div className="flex items-center justify-between mt-4 mb-2">
        <h2 className="text-sm font-semibold text-neutral-700">Posts</h2>
        <button onClick={() => setShowForm((s) => !s)} className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white">
          {showForm ? 'Cancel' : '+ Post'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl p-4 shadow-card mb-3 space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What's new?" rows={3} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <button
            onClick={() => postMutation.mutate()}
            disabled={postMutation.isPending || !title.trim() || !body.trim()}
            className="w-full rounded-lg bg-primary-600 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {postMutation.isPending ? 'Posting…' : 'Post'}
          </button>
        </div>
      )}

      {data.posts.length === 0 ? (
        <p className="text-center text-sm text-neutral-400 py-8">No posts yet.</p>
      ) : (
        <div className="space-y-2">
          {data.posts.map((post) => (
            <div key={post.id} className="bg-white rounded-xl p-4 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-neutral-900">{post.title}</p>
                  <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{post.body}</p>
                </div>
                <button onClick={() => deleteMutation.mutate(post.id)} className="flex-shrink-0 text-xs font-semibold text-red-600">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/business/pages/$pageId')({
  component: BusinessPageDetail,
});
