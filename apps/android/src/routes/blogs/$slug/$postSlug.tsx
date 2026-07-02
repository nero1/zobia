/**
 * apps/android/src/routes/blogs/$slug/$postSlug.tsx
 *
 * Article/page view — mirrors apps/web/app/b/[slug]/[postSlug]/page.tsx:
 * renders sanitized HTML from the server, paywall unlock notice + button,
 * like, view tracking (deduped via a local Preferences flag — same
 * mechanism as the web app's localStorage dedupe), and comments.
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Preferences } from '@capacitor/preferences';
import { apiClient } from '@/lib/api/client';

interface PostDetail {
  id: string;
  title: string;
  type: string;
  body_html: string;
  is_paywalled: boolean;
  paywall_credits_cost: number;
  view_count: number;
  like_count: number;
  comment_count: number;
  published_at: string | null;
  author_username: string | null;
  author_display_name: string | null;
}

interface PostDetailResponse {
  post: PostDetail;
  locked: boolean;
  isLiked: boolean;
  blog: { title: string; hideAuthorInfo: boolean };
}

interface CommentRow {
  id: string;
  body: string;
  status: string;
  author_username: string | null;
  author_display_name: string | null;
}

const VIEWED_KEY = 'zobia_blog_viewed';

async function markViewOnce(blogSlug: string, postSlug: string, postId: string) {
  const { value } = await Preferences.get({ key: VIEWED_KEY });
  const seen: string[] = value ? JSON.parse(value) : [];
  if (seen.includes(postId)) return;
  try {
    await apiClient.post(`/blogs/${blogSlug}/posts/${postSlug}/view`, {});
  } catch { /* best-effort */ }
  seen.push(postId);
  await Preferences.set({ key: VIEWED_KEY, value: JSON.stringify(seen.slice(-500)) });
}

function PostViewPage() {
  const { slug, postSlug } = Route.useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [commentText, setCommentText] = useState('');

  const postQuery = useQuery({
    queryKey: ['blogs', 'post', slug, postSlug],
    queryFn: async () => (await apiClient.get<{ data: PostDetailResponse }>(`/blogs/${slug}/posts/${postSlug}`)).data.data,
  });

  const commentsQuery = useQuery({
    queryKey: ['blogs', 'comments', slug, postSlug],
    queryFn: async () => (await apiClient.get<{ data: { comments: CommentRow[] } }>(`/blogs/${slug}/posts/${postSlug}/comments`)).data.data.comments,
    enabled: postQuery.data?.post.type === 'article',
  });

  useEffect(() => {
    if (postQuery.data?.post.id) void markViewOnce(slug, postSlug, postQuery.data.post.id);
  }, [slug, postSlug, postQuery.data?.post.id]);

  const toggleLike = useMutation({
    mutationFn: (next: boolean) => (next ? apiClient.post(`/blogs/${slug}/posts/${postSlug}/like`, {}) : apiClient.delete(`/blogs/${slug}/posts/${postSlug}/like`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blogs', 'post', slug, postSlug] }),
  });

  const unlock = useMutation({
    mutationFn: () => apiClient.post(`/blogs/${slug}/posts/${postSlug}/unlock`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blogs', 'post', slug, postSlug] }),
  });

  const postComment = useMutation({
    mutationFn: () => apiClient.post(`/blogs/${slug}/posts/${postSlug}/comments`, { body: commentText.trim() }),
    onSuccess: () => {
      setCommentText('');
      qc.invalidateQueries({ queryKey: ['blogs', 'comments', slug, postSlug] });
    },
  });

  const data = postQuery.data;

  if (postQuery.isPending) return <div className="h-full overflow-y-auto bg-neutral-50 p-4"><div className="h-24 rounded bg-neutral-200 animate-pulse" /></div>;
  if (!data) return <div className="h-full overflow-y-auto bg-neutral-50 p-6 text-center text-sm text-neutral-500">{t('blogs.notFound', 'Post not found.')}</div>;

  const { post, locked, isLiked, blog } = data;
  const isArticle = post.type === 'article';

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <h1 className="text-lg font-bold text-neutral-900">{post.title}</h1>
        {isArticle && post.published_at && (
          <p className="text-xs text-neutral-400 mt-1">{new Date(post.published_at).toLocaleDateString()}</p>
        )}
        {isArticle && !blog.hideAuthorInfo && (
          <p className="text-xs text-neutral-500 mt-2">
            {post.author_display_name ?? `@${post.author_username}`}
          </p>
        )}

        {/* Server-sanitized HTML — safe to render (sanitize-html allow-list applied server-side). */}
        <div className="prose prose-sm mt-3" dangerouslySetInnerHTML={{ __html: post.body_html }} />

        {locked && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
            <p className="text-sm text-amber-800 mb-2">
              {t('blogs.post.paywallNotice', 'Pay {{cost}} credits to read the rest of the article.', { cost: post.paywall_credits_cost })}
            </p>
            <button
              onClick={() => unlock.mutate()}
              disabled={unlock.isPending}
              className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {unlock.isPending ? t('blogs.post.unlocking', 'Unlocking…') : t('blogs.post.unlock', 'Unlock for {{cost}} credits', { cost: post.paywall_credits_cost })}
            </button>
          </div>
        )}

        {isArticle && (
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => toggleLike.mutate(!isLiked)}
              disabled={toggleLike.isPending}
              className="flex items-center gap-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm"
            >
              <span>{isLiked ? '❤️' : '🤍'}</span>
              <span>{post.like_count}</span>
            </button>
            <span className="text-xs text-neutral-400">👁 {post.view_count} views</span>
          </div>
        )}
      </div>

      {isArticle && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-bold text-neutral-900 mb-2">{t('blogs.post.comments', 'Comments')}</h2>
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value.slice(0, 2000))}
            rows={3}
            placeholder={t('blogs.post.commentPlaceholder', 'Add a comment…')}
            className="w-full resize-none rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
          />
          <div className="mt-2 flex justify-end">
            <button
              disabled={!commentText.trim() || postComment.isPending}
              onClick={() => postComment.mutate()}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {postComment.isPending ? t('blogs.post.posting', 'Posting…') : t('blogs.post.postComment', 'Post')}
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {(commentsQuery.data ?? []).map((c) => (
              <div key={c.id} className="rounded-lg border border-neutral-100 bg-neutral-50 p-2.5">
                <p className="text-xs font-semibold text-neutral-700">{c.author_display_name ?? `@${c.author_username}`}</p>
                <p className="text-sm text-neutral-800 mt-0.5">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/blogs/$slug/$postSlug')({
  component: PostViewPage,
});
