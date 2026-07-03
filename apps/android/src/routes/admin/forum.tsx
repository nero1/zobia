/**
 * apps/android/src/routes/admin/forum.tsx
 *
 * Answers (forum) admin — mirrors apps/web/app/(admin)/admin/forum/{page,
 * queue,posts}.tsx, collapsed into one screen with tabs (the web nav only
 * lists a single "Answers" entry; posts/queue are sub-pages reached from
 * within it there too — tabs are the native-mobile equivalent of that
 * in-page navigation).
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import {
  AdminCardSkeleton,
  AdminEmptyState,
  AdminToast,
  AdminTabs,
  AdminStatCard,
  AdminBadge,
  timeAgo,
} from '@/components/admin/AdminUI';

type TabKey = 'overview' | 'queue' | 'posts';

interface ForumStats {
  pendingReports: number;
  questionsToday: number;
  answersToday: number;
  topPosters: { username: string | null; questions: string; answers: string }[];
}

interface QueueItem {
  id: string;
  reporter_username: string | null;
  question_title: string | null;
  answer_body: string | null;
  report_type: string;
  status: string;
  ai_category: string | null;
  ai_confidence: number | null;
  created_at: string;
}

interface Question {
  id: string;
  title: string;
  status: string;
  vote_score: number;
  answer_count: number;
  is_locked: boolean;
  created_at: string;
  author_username: string;
}

async function fetchStats(): Promise<ForumStats> {
  const { data } = await apiClient.get<ForumStats>('/admin/forum/stats');
  return data;
}

async function fetchQueue(): Promise<QueueItem[]> {
  const { data } = await apiClient.get<{ items: QueueItem[] }>('/admin/forum/queue?status=pending');
  return data?.items ?? [];
}

async function fetchQuestions(): Promise<Question[]> {
  const { data } = await apiClient.get<{ items: Question[] }>('/admin/forum/posts?type=question&status=all&limit=30');
  return data?.items ?? [];
}

function AdminForumPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('overview');
  const [toast, setToast] = useState<string | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const { data: stats, status: statsStatus } = useQuery({ queryKey: ['admin', 'forum', 'stats'], queryFn: fetchStats, enabled: tab === 'overview' });
  const { data: queue, status: queueStatus } = useQuery({ queryKey: ['admin', 'forum', 'queue'], queryFn: fetchQueue, enabled: tab === 'queue' });
  const { data: questions, status: questionsStatus } = useQuery({ queryKey: ['admin', 'forum', 'posts'], queryFn: fetchQuestions, enabled: tab === 'posts' });

  const queueAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => apiClient.post(`/admin/forum/queue/${id}/action`, { action }),
    onSuccess: () => {
      notify(t('admin.moderation.actionApplied', 'Action applied'));
      qc.invalidateQueries({ queryKey: ['admin', 'forum', 'queue'] });
    },
    onError: () => notify(t('admin.moderation.actionFailed', 'Action failed')),
  });

  const postAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      apiClient.patch(`/admin/forum/posts/${id}`, { targetType: 'question', action }),
    onSuccess: () => {
      notify(t('admin.moderation.actionApplied', 'Action applied'));
      qc.invalidateQueries({ queryKey: ['admin', 'forum', 'posts'] });
    },
    onError: () => notify(t('admin.moderation.actionFailed', 'Action failed')),
  });

  const tabs = [
    { key: 'overview' as const, label: t('admin.forum.tab.overview', 'Overview') },
    { key: 'queue' as const, label: t('admin.forum.tab.queue', 'Queue') },
    { key: 'posts' as const, label: t('admin.forum.tab.posts', 'Posts') },
  ];

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.nav.forum', 'Answers')}</h1>
      {toast && <AdminToast message={toast} />}
      <AdminTabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="space-y-4">
          {statsStatus === 'pending' && (
            <div className="grid grid-cols-3 gap-2.5">{Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}</div>
          )}
          {statsStatus === 'success' && stats && (
            <>
              <div className="grid grid-cols-3 gap-2.5">
                <AdminStatCard label={t('admin.forum.pendingReports', 'Pending Reports')} value={String(stats.pendingReports)} color={stats.pendingReports > 0 ? 'red' : 'neutral'} />
                <AdminStatCard label={t('admin.forum.questionsToday', 'Questions Today')} value={String(stats.questionsToday)} color="blue" />
                <AdminStatCard label={t('admin.forum.answersToday', 'Answers Today')} value={String(stats.answersToday)} color="green" />
              </div>
              <div>
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{t('admin.forum.topPosters', 'Top Posters (7d)')}</h2>
                <div className="space-y-1.5">
                  {stats.topPosters.map((p, i) => (
                    <div key={p.username ?? i} className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm">
                      <span className="font-medium text-neutral-800">@{p.username ?? '—'}</span>
                      <span className="text-xs text-neutral-500">{p.questions}Q · {p.answers}A</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'queue' && (
        <div className="space-y-2.5">
          {queueStatus === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}
          {queueStatus === 'success' && (queue?.length ?? 0) === 0 && (
            <AdminEmptyState icon="✓" title={t('admin.moderation.queueClear', 'Queue is clear ✓')} />
          )}
          {queueStatus === 'success' &&
            queue?.map((item) => (
              <div key={item.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs">
                  <span className="font-semibold text-neutral-700">@{item.reporter_username ?? '—'}</span>
                  <AdminBadge label={item.report_type.replace(/_/g, ' ')} />
                  <span className="ml-auto text-neutral-400">{timeAgo(item.created_at)}</span>
                </div>
                <p className="mb-2.5 line-clamp-2 text-sm text-neutral-700">{item.question_title ?? item.answer_body ?? '—'}</p>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => queueAction.mutate({ id: item.id, action: 'dismiss' })} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700">
                    {t('admin.moderation.action.dismiss', 'Dismiss')}
                  </button>
                  <button onClick={() => queueAction.mutate({ id: item.id, action: 'warn' })} className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                    {t('admin.moderation.action.warn', 'Warn User')}
                  </button>
                  <button onClick={() => queueAction.mutate({ id: item.id, action: 'remove_content' })} className="rounded-lg bg-orange-100 px-2.5 py-1 text-xs font-semibold text-orange-700">
                    {t('admin.moderation.action.remove', 'Remove Content')}
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}

      {tab === 'posts' && (
        <div className="space-y-2.5">
          {questionsStatus === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}
          {questionsStatus === 'success' && (questions?.length ?? 0) === 0 && <AdminEmptyState icon="❓" title={t('admin.forum.noQuestions', 'No questions')} />}
          {questionsStatus === 'success' &&
            questions?.map((q) => (
              <div key={q.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
                <div className="mb-1 flex items-center gap-1.5 text-xs">
                  <AdminBadge label={q.status} color={q.status === 'visible' ? 'green' : 'red'} />
                  {q.is_locked && <AdminBadge label={t('admin.forum.locked', 'Locked')} color="gold" />}
                  <span className="ml-auto text-neutral-400">{timeAgo(q.created_at)}</span>
                </div>
                <p className="mb-1 text-sm font-medium text-neutral-900 line-clamp-2">{q.title}</p>
                <p className="mb-2.5 text-xs text-neutral-500">@{q.author_username} · {q.vote_score} {t('admin.forum.votes', 'votes')} · {q.answer_count} {t('admin.forum.answers', 'answers')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {q.status === 'visible' ? (
                    <button onClick={() => postAction.mutate({ id: q.id, action: 'remove' })} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700">
                      {t('admin.forum.remove', 'Remove')}
                    </button>
                  ) : (
                    <button onClick={() => postAction.mutate({ id: q.id, action: 'restore' })} className="rounded-lg bg-success-100 px-2.5 py-1 text-xs font-semibold text-success-700">
                      {t('admin.forum.restore', 'Restore')}
                    </button>
                  )}
                  <button onClick={() => postAction.mutate({ id: q.id, action: q.is_locked ? 'unlock' : 'lock' })} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700">
                    {q.is_locked ? t('admin.forum.unlock', 'Unlock') : t('admin.forum.lock', 'Lock')}
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/forum')({
  component: AdminForumPage,
});
