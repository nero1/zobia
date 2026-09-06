/**
 * apps/android/src/routes/forum/thread/$slug.tsx
 *
 * Forum thread detail — mirrors apps/web/app/f/[slug]/page.tsx: post list
 * (with reactions, quote, edit/delete/report), reply composer (plain
 * text/Markdown tabs, optional image), and the OP-funded reply pot banner.
 *
 * Post bodies come back as raw source text (plain text or Markdown) from the
 * API — this native view renders plain text as-is (whitespace-pre-wrap) and
 * Markdown as raw text too (no in-app Markdown renderer yet); the fully
 * rendered HTML is only produced server-side for the web/PWA page. This
 * mirrors the same simplification already used by the Answers detail route
 * in this app (apps/android/src/routes/answers/$questionId.tsx), which also
 * renders `body` as plain whitespace-pre-wrap text.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';

interface Board { slug: string; name: string; }
interface Thread {
  id: string; slug: string; title: string; is_locked: boolean; is_pinned: boolean;
  view_count: number; reply_count: number; edited_at: string | null;
  pot_total_credits: number; pot_per_claim_credits: number; pot_max_claims: number;
  pot_claims_count: number; pot_refunded_at: string | null;
}
interface Post {
  id: string; author_id: string; body: string; content_format: 'plaintext' | 'markdown';
  image_url: string | null; is_op: boolean; reaction_count: number; created_at: string;
  edited_at: string | null; author_username: string | null; author_display_name: string | null;
  author_avatar_emoji: string | null; quoted_body: string | null;
  quoted_author_username: string | null; quoted_author_display_name: string | null;
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '🤔'];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function ThreadDetailPage() {
  const { slug } = Route.useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [replyBody, setReplyBody] = useState('');
  const [replyFormat, setReplyFormat] = useState<'plaintext' | 'markdown'>('plaintext');
  const [replyImageUrl, setReplyImageUrl] = useState<string | null>(null);
  const [quoted, setQuoted] = useState<{ id: string; author: string; snippet: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const query = useQuery({
    queryKey: ['bbforum', 'thread', slug],
    queryFn: async () => (await apiClient.get<{ thread: Thread; posts: Post[]; board: Board }>(`/forum/threads/${slug}`)).data,
  });

  const reply = useMutation({
    mutationFn: () => apiClient.post(`/forum/threads/${slug}/posts`, {
      body: replyBody.trim(), contentFormat: replyFormat, imageUrl: replyImageUrl ?? undefined, quotedPostId: quoted?.id,
    }),
    onSuccess: () => {
      setReplyBody(''); setReplyImageUrl(null); setQuoted(null);
      qc.invalidateQueries({ queryKey: ['bbforum', 'thread', slug] });
    },
  });

  const react = useMutation({
    mutationFn: ({ postId, emoji }: { postId: string; emoji: string }) => apiClient.post(`/forum/posts/${postId}/react`, { emoji }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bbforum', 'thread', slug] }),
  });

  const editPost = useMutation({
    mutationFn: ({ postId, body }: { postId: string; body: string }) => apiClient.patch(`/forum/posts/${postId}`, { body, contentFormat: replyFormat }),
    onSuccess: () => { setEditingId(null); qc.invalidateQueries({ queryKey: ['bbforum', 'thread', slug] }); },
  });

  const deletePost = useMutation({
    mutationFn: (postId: string) => apiClient.delete(`/forum/posts/${postId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bbforum', 'thread', slug] }),
  });

  const report = useMutation({
    mutationFn: (postId: string) => apiClient.post('/reports', { reportedBbPostId: postId, reportType: 'other' }),
  });

  async function handleUploadImage(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiClient.post<{ url: string }>('/forum/uploads/image', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setReplyImageUrl(res.data.url);
    } finally {
      setUploading(false);
    }
  }

  const thread = query.data?.thread;
  const board = query.data?.board;
  const posts = query.data?.posts ?? [];
  const potRemaining = thread ? thread.pot_max_claims - thread.pot_claims_count : 0;

  if (query.isPending) {
    return <div className="h-full overflow-y-auto bg-neutral-50 p-4"><div className="h-24 rounded bg-neutral-200 animate-pulse" /></div>;
  }
  if (!thread) {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 p-6 text-center">
        <p className="text-sm text-neutral-500">{t('error.generic')}</p>
        <Link to="/forum" className="mt-3 inline-block text-sm font-semibold text-primary-600">← {t('bbforum.forum.title')}</Link>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-3 space-y-3">
      {board && <Link to="/forum/$boardSlug" params={{ boardSlug: board.slug }} className="text-xs text-neutral-500">← {board.name}</Link>}
      <h1 className="text-base font-bold text-neutral-900">
        {thread.is_pinned && <span className="mr-1 text-amber-500">📌</span>}
        {thread.is_locked && <span className="mr-1 text-neutral-400">🔒</span>}
        {thread.title}
      </h1>

      {thread.pot_max_claims > 0 && !thread.pot_refunded_at && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t('bbforum.pot.banner', { amount: thread.pot_per_claim_credits, max: thread.pot_max_claims })}{' '}
          {potRemaining > 0 ? t('bbforum.pot.remaining', { count: potRemaining }) : t('bbforum.pot.full')}
        </div>
      )}

      {posts.map((post) => {
        const canModify = user?.id === post.author_id;
        return (
          <div key={post.id} className="rounded-xl border border-neutral-200 bg-white p-3">
            <div className="mb-1.5 flex items-center gap-2 text-xs text-neutral-500">
              <span>{post.author_avatar_emoji ?? '👤'}</span>
              <span className="font-semibold text-neutral-700">{post.author_display_name ?? post.author_username ?? 'Unknown'}</span>
              {post.is_op && <span className="rounded-full bg-primary-100 px-1.5 py-0.5 text-[10px] font-semibold text-primary-700">OP</span>}
              <span>·</span>
              <span>{timeAgo(post.created_at)}</span>
              {post.edited_at && <span className="italic text-neutral-400">({t('bbforum.post.edited')})</span>}
              <button onClick={() => setMenuOpenId(menuOpenId === post.id ? null : post.id)} className="ml-auto text-neutral-400">⋯</button>
            </div>

            {menuOpenId === post.id && (
              <div className="mb-2 flex flex-wrap gap-2 text-xs">
                <button onClick={() => { setQuoted({ id: post.id, author: post.author_display_name ?? post.author_username ?? 'Unknown', snippet: post.body.slice(0, 140) }); setMenuOpenId(null); }} className="font-semibold text-neutral-500">{t('bbforum.post.quote')}</button>
                {canModify && <button onClick={() => { setEditingId(post.id); setEditBody(post.body); setMenuOpenId(null); }} className="font-semibold text-neutral-500">{t('bbforum.post.edit')}</button>}
                {canModify && <button onClick={() => { if (window.confirm(t('bbforum.post.deleteConfirm'))) deletePost.mutate(post.id); setMenuOpenId(null); }} className="font-semibold text-red-600">{t('bbforum.post.delete')}</button>}
                {!canModify && <button onClick={() => { report.mutate(post.id); setMenuOpenId(null); }} className="font-semibold text-amber-600">{t('bbforum.post.report')}</button>}
              </div>
            )}

            {post.quoted_body && (
              <div className="mb-2 rounded-lg border-l-4 border-neutral-300 bg-neutral-50 px-2 py-1 text-xs text-neutral-500">
                <span className="font-semibold">{post.quoted_author_display_name ?? post.quoted_author_username}:</span> {post.quoted_body.slice(0, 140)}
              </div>
            )}

            {editingId === post.id ? (
              <div className="space-y-2">
                <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={3} className="w-full resize-none rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm" />
                <div className="flex gap-2">
                  <button onClick={() => setEditingId(null)} className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold">{t('bbforum.post.cancel')}</button>
                  <button onClick={() => editPost.mutate({ postId: post.id, body: editBody })} className="rounded-lg bg-primary-600 px-3 py-1 text-xs font-semibold text-white">{t('bbforum.post.save')}</button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-sm text-neutral-800">{post.body}</p>
            )}
            {post.image_url && <img src={post.image_url} alt="" className="mt-2 max-h-72 rounded-lg" />}

            <div className="mt-2 flex flex-wrap gap-1">
              {REACTION_EMOJIS.map((emoji) => (
                <button key={emoji} onClick={() => react.mutate({ postId: post.id, emoji })} className="rounded-full border border-neutral-200 px-1.5 py-0.5 text-sm">{emoji}</button>
              ))}
              {post.reaction_count > 0 && <span className="self-center text-xs text-neutral-400">{post.reaction_count}</span>}
            </div>
          </div>
        );
      })}

      {thread.is_locked ? (
        <p className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-500">🔒 {t('bbforum.locked')}</p>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white p-3 space-y-2">
          {quoted && (
            <div className="flex items-start gap-2 rounded-lg border-l-4 border-primary-400 bg-neutral-50 px-2 py-1 text-xs text-neutral-600">
              <div className="min-w-0 flex-1"><span className="font-semibold">{t('bbforum.editor.quoting', { author: quoted.author })}</span> {quoted.snippet}</div>
              <button onClick={() => setQuoted(null)} className="text-neutral-400">✕</button>
            </div>
          )}
          <div className="flex gap-1 text-xs font-semibold">
            {(['plaintext', 'markdown'] as const).map((fmt) => (
              <button key={fmt} onClick={() => setReplyFormat(fmt)} className={`rounded-t-lg px-3 py-1.5 ${replyFormat === fmt ? 'bg-neutral-100 text-primary-700' : 'text-neutral-400'}`}>
                {fmt === 'plaintext' ? t('bbforum.editor.tabPlainText') : t('bbforum.editor.tabMarkdown')}
              </button>
            ))}
          </div>
          <textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value.slice(0, 20000))} rows={3} placeholder={t('bbforum.reply.placeholder')} className="w-full resize-none rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm" />
          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600">
              {uploading ? t('bbforum.editor.uploading') : `📷 ${t('bbforum.editor.addImage')}`}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUploadImage(f); }} />
            </label>
            {replyImageUrl && <button onClick={() => setReplyImageUrl(null)} className="text-xs font-semibold text-red-600">{t('bbforum.editor.removeImage')}</button>}
          </div>
          {replyImageUrl && <img src={replyImageUrl} alt="" className="max-h-40 rounded-lg" />}
          <div className="flex justify-end">
            <button disabled={replyBody.trim().length < 2 || reply.isPending} onClick={() => reply.mutate()} className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {reply.isPending ? t('bbforum.reply.posting') : t('bbforum.reply.post')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/forum/thread/$slug')({
  component: ThreadDetailPage,
});
