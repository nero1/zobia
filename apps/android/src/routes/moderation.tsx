/**
 * apps/android/src/routes/moderation.tsx
 *
 * Moderation Center — mirrors apps/web/app/(app)/moderation/page.tsx.
 * Standalone (outside /admin) area reachable by moderators and admins,
 * unifying the general report queue and the Answers forum queue, plus an
 * admin-only audit log. Client-side gate redirects a non-mod to /home; the
 * underlying endpoints already enforce withModeratorOrAdminAuth server-side.
 */

import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';
import { AdminCardSkeleton, AdminEmptyState, AdminToast, AdminTabs, timeAgo } from '@/components/admin/AdminUI';

type QueueKey = 'reports' | 'forum' | 'audit';
type StatusFilter = 'pending' | 'resolved' | 'escalated';

interface ReportItem {
  id: string;
  reporter_username: string | null;
  reported_user_username?: string | null;
  question_title?: string | null;
  answer_body?: string | null;
  report_type: string;
  status: string;
  ai_confidence: number | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by_username: string | null;
  resolution_note: string | null;
  action_id: string | null;
}

interface AuditItem {
  id: string;
  action_type: string;
  reason: string | null;
  target_username: string | null;
  moderator_username: string | null;
  created_at: string;
  reversed_at: string | null;
  reversed_by_username: string | null;
  reversal_note: string | null;
}

const ACTIONS: { label: string; action: string; durationHours?: number; adminOnly?: boolean }[] = [
  { label: 'Dismiss', action: 'dismiss' },
  { label: 'Warn', action: 'warn' },
  { label: 'Remove', action: 'remove_content' },
  { label: 'Suspend 24h', action: 'suspend_user', durationHours: 24 },
  { label: 'Suspend 7d', action: 'suspend_user', durationHours: 168 },
  { label: 'Ban', action: 'ban_user', adminOnly: true },
];

async function fetchQueue(queue: QueueKey, status: StatusFilter): Promise<{ items: ReportItem[]; audit: AuditItem[] }> {
  if (queue === 'audit') {
    const { data } = await apiClient.get<{ items: AuditItem[] }>('/admin/moderation/audit');
    return { items: [], audit: data.items ?? [] };
  }
  const endpoint = queue === 'forum' ? '/admin/forum/queue' : '/admin/moderation';
  const { data } = await apiClient.get<{ items: ReportItem[] }>(`${endpoint}?status=${status}`);
  return { items: data.items ?? [], audit: [] };
}

function ModerationCenterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();

  const isAdmin = Boolean(user?.is_admin);
  const isMod = Boolean(user?.is_admin || user?.is_moderator);

  if (user && !isMod) {
    navigate({ to: '/home', replace: true });
  }

  const [queue, setQueue] = useState<QueueKey>('reports');
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const { data, isLoading } = useQuery({
    queryKey: ['moderation-center', queue, status],
    queryFn: () => fetchQueue(queue, status),
    enabled: isMod,
  });

  const actionMutation = useMutation({
    mutationFn: async ({ item, action, durationHours }: { item: ReportItem; action: string; durationHours?: number }) => {
      const endpoint = queue === 'forum' ? `/admin/forum/queue/${item.id}/action` : `/admin/moderation/${item.id}/action`;
      await apiClient.post(endpoint, { action, ...(durationHours ? { duration_hours: durationHours } : {}) });
    },
    onSuccess: () => {
      showToast(t('moderation.actionApplied', 'Action applied'));
      void qc.invalidateQueries({ queryKey: ['moderation-center'] });
    },
    onError: () => showToast(t('moderation.actionFailedGeneric', 'Action failed'), 'error'),
  });

  const reverseMutation = useMutation({
    mutationFn: async (item: ReportItem) => {
      if (!item.action_id) return;
      await apiClient.post(`/admin/moderation/actions/${item.action_id}/reverse`, {});
    },
    onSuccess: () => {
      showToast(t('moderation.actionReversed', 'Action reversed'));
      void qc.invalidateQueries({ queryKey: ['moderation-center'] });
    },
    onError: () => showToast(t('moderation.actionFailedGeneric', 'Action failed'), 'error'),
  });

  if (!isMod) return null;

  const tabs: { key: QueueKey; label: string }[] = [
    { key: 'reports', label: t('moderation.tab.reports', 'Reports') },
    { key: 'forum', label: t('moderation.tab.forum', 'Forum Queue') },
    ...(isAdmin ? [{ key: 'audit' as QueueKey, label: t('moderation.tab.audit', 'Audit Log') }] : []),
  ];

  const items = data?.items ?? [];
  const auditItems = data?.audit ?? [];

  return (
    <div className="p-4">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('moderation.title', 'Moderation Center')}</h1>
      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <AdminTabs tabs={tabs} active={queue} onChange={setQueue} />

      {queue !== 'audit' && (
        <div className="mb-4 flex gap-2 text-xs">
          {(['pending', 'resolved', 'escalated'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 font-semibold capitalize ${status === s ? 'bg-primary-600 text-white' : 'bg-neutral-100 text-neutral-600'}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)
        ) : queue === 'audit' ? (
          auditItems.length === 0 ? (
            <AdminEmptyState title={t('moderation.noAuditEntries', 'No moderation activity yet.')} />
          ) : (
            auditItems.map((a) => (
              <div key={a.id} className="rounded-xl border border-neutral-200 bg-white p-3 text-xs">
                <p>
                  <span className="font-semibold capitalize">{a.action_type.replace(/_/g, ' ')}</span>
                  {a.target_username && <> on @{a.target_username}</>}
                  {a.moderator_username && <> by @{a.moderator_username}</>}
                  <span className="text-neutral-400"> · {timeAgo(a.created_at)}</span>
                </p>
                {a.reversed_at && (
                  <p className="mt-1 text-amber-600">
                    {t('moderation.reversedBy', 'Reversed')}{a.reversed_by_username && <> by @{a.reversed_by_username}</>}
                  </p>
                )}
              </div>
            ))
          )
        ) : items.length === 0 ? (
          <AdminEmptyState icon="✓" title={t('moderation.queueClear', 'Queue is clear.')} />
        ) : (
          items.map((item) => {
            const isBusy = actionMutation.isPending || reverseMutation.isPending;
            const title = queue === 'forum' ? item.question_title ?? item.answer_body ?? '(forum content)' : item.reported_user_username ?? '(target)';
            return (
              <div key={item.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-neutral-700">@{item.reporter_username ?? 'unknown'}</span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold text-neutral-700">{item.report_type.replace(/_/g, ' ')}</span>
                  <span className="ml-auto text-neutral-400">{timeAgo(item.created_at)}</span>
                </div>
                <p className="mb-3 truncate text-sm text-neutral-700">{title}</p>
                {item.status === 'pending' ? (
                  <div className="flex flex-wrap gap-1.5">
                    {ACTIONS.filter((a) => !a.adminOnly || isAdmin).map(({ label, action, durationHours }) => (
                      <button
                        key={label}
                        disabled={isBusy}
                        onClick={() => actionMutation.mutate({ item, action, durationHours })}
                        className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 disabled:opacity-50"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-2 text-xs text-neutral-500">
                    <span className="font-medium capitalize">{item.status}</span>
                    {item.resolved_by_username && <> · by @{item.resolved_by_username}</>}
                    {item.action_id && (
                      <button
                        disabled={isBusy}
                        onClick={() => reverseMutation.mutate(item)}
                        className="ml-2 rounded-full bg-neutral-200 px-2 py-0.5 font-semibold text-neutral-700 disabled:opacity-50"
                      >
                        Reverse
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/moderation')({
  component: ModerationCenterPage,
});
