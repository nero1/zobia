/**
 * apps/android/src/routes/admin/forum.tsx
 *
 * Answers (forum) admin — mirrors apps/web/app/(admin)/admin/forum/{page,
 * queue,posts,settings}.tsx, collapsed into one screen with tabs (the web nav
 * only lists a single "Answers" entry; posts/queue/settings are sub-pages
 * reached from within it there too — tabs are the native-mobile equivalent
 * of that in-page navigation).
 *
 * Settings tab: GET/PUT /admin/config[/:key] (same generic x_manifest rows
 * editable at web's /gate44/config and /gate44/support/settings — see
 * admin/config.tsx) plus GET/POST/DELETE /admin/forum/categories.
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
  AdminToggle,
  adminInputClass,
  timeAgo,
} from '@/components/admin/AdminUI';

type TabKey = 'overview' | 'queue' | 'posts' | 'settings';

interface ConfigEntry {
  key: string;
  value: string;
  description: string | null;
  updatedAt: string | null;
}

interface ForumCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon_emoji: string;
  sort_order: number;
  question_count: string;
}

const SETTINGS_FIELDS: { key: string; label: string; type: 'boolean' | 'number' }[] = [
  { key: 'feature_forum', label: 'Enable Answers', type: 'boolean' },
  { key: 'forum_min_level_to_post', label: 'Min Level to Post', type: 'number' },
  { key: 'forum_min_level_to_comment', label: 'Min Level to Comment (Free)', type: 'number' },
  { key: 'forum_comment_bypass_cost_credits', label: 'Comment Bypass Cost (Credits)', type: 'number' },
  { key: 'forum_reward_xp_per_question', label: 'XP per Question', type: 'number' },
  { key: 'forum_reward_credits_per_question', label: 'Credits per Question', type: 'number' },
  { key: 'forum_reward_xp_per_answer', label: 'XP per Answer', type: 'number' },
  { key: 'forum_reward_credits_per_answer', label: 'Credits per Answer', type: 'number' },
  { key: 'forum_reward_xp_per_upvote', label: 'XP per Upvote Received', type: 'number' },
  { key: 'forum_reward_credits_per_upvote', label: 'Credits per Upvote Received', type: 'number' },
  { key: 'forum_reward_xp_best_answer', label: 'XP for Best Answer', type: 'number' },
  { key: 'forum_reward_credits_best_answer', label: 'Credits for Best Answer', type: 'number' },
  { key: 'forum_daily_reward_cap_credits', label: 'Daily Reward Cap (Credits)', type: 'number' },
  { key: 'forum_auto_moderation_enabled', label: 'Auto-Moderation', type: 'boolean' },
];

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

async function fetchConfig(): Promise<Record<string, string>> {
  const { data } = await apiClient.get<ConfigEntry[]>('/admin/config');
  const map: Record<string, string> = {};
  (data ?? []).forEach((e) => { map[e.key] = e.value; });
  return map;
}

async function fetchCategories(): Promise<ForumCategory[]> {
  const { data } = await apiClient.get<{ categories: ForumCategory[] }>('/admin/forum/categories');
  return data?.categories ?? [];
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
  const { data: config, status: configStatus } = useQuery({ queryKey: ['admin', 'config'], queryFn: fetchConfig, enabled: tab === 'settings' });
  const { data: categories, status: categoriesStatus } = useQuery({ queryKey: ['admin', 'forum', 'categories'], queryFn: fetchCategories, enabled: tab === 'settings' });
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('💬');

  const saveConfig = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => apiClient.put(`/admin/config/${key}`, { value }),
    onMutate: ({ key }) => setSavingKey(key),
    onSuccess: () => {
      notify(t('admin.saved', 'Saved'));
      qc.invalidateQueries({ queryKey: ['admin', 'config'] });
    },
    onError: () => notify(t('admin.saveFailed', 'Save failed')),
    onSettled: () => setSavingKey(null),
  });

  const createCategory = useMutation({
    mutationFn: () => apiClient.post('/admin/forum/categories', { name: newCatName.trim(), iconEmoji: newCatIcon || '💬' }),
    onSuccess: () => {
      notify(t('admin.forum.categoryCreated', 'Category created'));
      setNewCatName('');
      qc.invalidateQueries({ queryKey: ['admin', 'forum', 'categories'] });
    },
    onError: () => notify(t('admin.forum.categoryCreateFailed', 'Failed to create category')),
  });

  const deleteCategory = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/forum/categories/${id}`),
    onSuccess: () => {
      notify(t('admin.forum.categoryDeleted', 'Category deleted'));
      qc.invalidateQueries({ queryKey: ['admin', 'forum', 'categories'] });
    },
    onError: () => notify(t('admin.forum.categoryDeleteFailed', 'Failed to delete category (it may still have questions)')),
  });

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
    { key: 'settings' as const, label: t('admin.forum.tab.settings', 'Settings') },
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

      {tab === 'settings' && (
        <div className="space-y-5">
          <div>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{t('admin.forum.configTitle', 'Answers Config')}</h2>
            <div className="space-y-2.5">
              {configStatus === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}
              {configStatus === 'success' &&
                SETTINGS_FIELDS.map((field) => {
                  const raw = config?.[field.key] ?? '';
                  const isSaving = savingKey === field.key;
                  return (
                    <div key={field.key} className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3.5 shadow-card">
                      <p className="text-sm font-medium text-neutral-800">{field.label}</p>
                      {field.type === 'boolean' ? (
                        <AdminToggle checked={raw === 'true'} disabled={isSaving} onChange={(v) => saveConfig.mutate({ key: field.key, value: v ? 'true' : 'false' })} />
                      ) : (
                        <input
                          type="number"
                          defaultValue={raw}
                          disabled={isSaving}
                          onBlur={(e) => { if (e.target.value !== raw) saveConfig.mutate({ key: field.key, value: e.target.value }); }}
                          className="w-20 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-right text-sm text-neutral-900 disabled:opacity-50"
                        />
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{t('admin.forum.categoriesTitle', 'Categories')}</h2>
            <div className="mb-3 flex gap-2">
              <input value={newCatIcon} onChange={(e) => setNewCatIcon(e.target.value)} className={`${adminInputClass} w-14 text-center`} maxLength={4} />
              <input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder={t('admin.forum.newCategoryPlaceholder', 'New category name')}
                className={adminInputClass}
              />
              <button
                type="button"
                onClick={() => createCategory.mutate()}
                disabled={!newCatName.trim() || createCategory.isPending}
                className="shrink-0 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {t('admin.forum.addCategory', 'Add')}
              </button>
            </div>
            <div className="space-y-2">
              {categoriesStatus === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}
              {categoriesStatus === 'success' && (categories?.length ?? 0) === 0 && (
                <AdminEmptyState icon="🗂" title={t('admin.forum.noCategories', 'No categories yet')} />
              )}
              {categoriesStatus === 'success' &&
                categories?.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-3.5 shadow-card">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-neutral-900">{c.icon_emoji} {c.name}</p>
                      <p className="text-xs text-neutral-500">/{c.slug} · {c.question_count} {t('admin.forum.questions', 'questions')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteCategory.mutate(c.id)}
                      disabled={deleteCategory.isPending}
                      className="shrink-0 rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700 disabled:opacity-50"
                    >
                      {t('admin.forum.deleteCategory', 'Delete')}
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/forum')({
  component: AdminForumPage,
});
