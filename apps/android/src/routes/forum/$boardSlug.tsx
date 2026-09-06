/**
 * apps/android/src/routes/forum/$boardSlug.tsx
 *
 * Thread list for one forum board — mirrors apps/web/app/forum/[boardSlug]/page.tsx.
 * Includes the "start a new thread" composer (plain text/Markdown, optional
 * image, optional OP-funded reply pot).
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';
import { useBbforumConfig } from '@/lib/hooks/useBbforumConfig';

interface BoardRow { id: string; slug: string; name: string; description: string | null; icon_emoji: string; }
interface ThreadRow {
  id: string; slug: string; title: string; is_locked: boolean; is_pinned: boolean;
  view_count: number; reply_count: number; last_reply_at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function BoardPage() {
  const { boardSlug } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const bbforumConfig = useBbforumConfig();
  const qc = useQueryClient();

  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [contentFormat, setContentFormat] = useState<'plaintext' | 'markdown'>('plaintext');
  const [potEnabled, setPotEnabled] = useState(false);
  const [potPerClaim, setPotPerClaim] = useState(10);
  const [potMaxClaims, setPotMaxClaims] = useState(5);

  const { data, status } = useQuery({
    queryKey: ['bbforum', 'threads', boardSlug],
    queryFn: async () => (await apiClient.get<{ board: BoardRow; threads: ThreadRow[] }>(`/forum/boards/${boardSlug}/threads`)).data,
  });

  const createThread = useMutation({
    mutationFn: () => apiClient.post<{ thread: ThreadRow }>(`/forum/boards/${boardSlug}/threads`, {
      title: title.trim(),
      body: body.trim(),
      contentFormat,
      ...(potEnabled ? { potPerClaimCredits: potPerClaim, potMaxClaims } : {}),
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['bbforum', 'threads', boardSlug] });
      navigate({ to: '/forum/thread/$slug', params: { slug: res.data.thread.slug } });
    },
  });

  const myLevel = (user as { rank_level?: number } | null)?.rank_level;
  const canPost = myLevel == null || myLevel >= bbforumConfig.minLevelToPost;
  const board = data?.board;
  const threads = data?.threads ?? [];

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      <div className="bg-white px-4 py-3 border-b border-neutral-100">
        <Link to="/forum" className="text-xs text-neutral-500">← {t('bbforum.forum.title')}</Link>
        <h1 className="text-lg font-bold text-neutral-900">{board?.icon_emoji} {board?.name}</h1>
      </div>

      <div className="p-3">
        {canPost ? (
          composerOpen ? (
            <div className="rounded-xl border border-neutral-200 bg-white p-3 space-y-2">
              <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 200))} placeholder={t('bbforum.thread.titleLabel')} className="w-full rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm" />
              <div className="flex gap-1 text-xs font-semibold">
                {(['plaintext', 'markdown'] as const).map((fmt) => (
                  <button key={fmt} onClick={() => setContentFormat(fmt)} className={`rounded-t-lg px-3 py-1.5 ${contentFormat === fmt ? 'bg-neutral-100 text-primary-700' : 'text-neutral-400'}`}>
                    {fmt === 'plaintext' ? t('bbforum.editor.tabPlainText') : t('bbforum.editor.tabMarkdown')}
                  </button>
                ))}
              </div>
              <textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, 20000))} rows={5} placeholder={t('bbforum.thread.bodyPlaceholder')} className="w-full resize-none rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 text-xs font-semibold text-amber-700">
                <input type="checkbox" checked={potEnabled} onChange={(e) => setPotEnabled(e.target.checked)} />
                💰 {t('bbforum.pot.fundLabel')}
              </label>
              {potEnabled && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                  <input type="number" min={1} value={potPerClaim} onChange={(e) => setPotPerClaim(Math.max(1, parseInt(e.target.value, 10) || 1))} className="w-16 rounded border border-neutral-300 px-2 py-1 text-center" />
                  <span>x</span>
                  <input type="number" min={1} value={potMaxClaims} onChange={(e) => setPotMaxClaims(Math.max(1, parseInt(e.target.value, 10) || 1))} className="w-16 rounded border border-neutral-300 px-2 py-1 text-center" />
                  <span>= {potPerClaim * potMaxClaims} Credits charged now</span>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => setComposerOpen(false)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700">{t('bbforum.thread.cancel')}</button>
                <button disabled={title.trim().length < 5 || body.trim().length < 10 || createThread.isPending} onClick={() => createThread.mutate()} className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                  {createThread.isPending ? t('bbforum.thread.posting') : t('bbforum.thread.post')}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setComposerOpen(true)} className="w-full rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-left text-sm text-neutral-500">
              {t('bbforum.board.newThread')}
            </button>
          )
        ) : (
          <p className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-xs text-neutral-400">
            {t('bbforum.levelTooLow', { level: bbforumConfig.minLevelToPost, current: myLevel ?? 1 })}
          </p>
        )}
      </div>

      {status === 'pending' && <div className="p-3"><div className="h-16 rounded bg-neutral-200 animate-pulse" /></div>}

      {status === 'success' && threads.length === 0 && (
        <p className="p-6 text-center text-sm text-neutral-500">{t('bbforum.board.noThreads')}</p>
      )}

      <div className="divide-y divide-neutral-100 bg-white">
        {threads.map((thread) => (
          <Link key={thread.id} to="/forum/thread/$slug" params={{ slug: thread.slug }} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-neutral-900 text-sm">
                {thread.is_pinned && <span className="mr-1 text-amber-500">📌</span>}
                {thread.is_locked && <span className="mr-1 text-neutral-400">🔒</span>}
                {thread.title}
              </p>
              <p className="text-xs text-neutral-400">
                {thread.reply_count} {t('bbforum.board.replies')} · {thread.view_count} {t('bbforum.board.views')} · {t('bbforum.board.lastReply', { time: timeAgo(thread.last_reply_at) })}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/forum/$boardSlug')({
  component: BoardPage,
});
