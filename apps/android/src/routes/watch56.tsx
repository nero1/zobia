/**
 * apps/android/src/routes/watch56.tsx
 *
 * Moderation Center — mirrors apps/web/app/(app)/watch56/page.tsx.
 * Standalone (outside /admin) area reachable by Platform Mods, Forum Mods
 * (guild-scoped), and Admins. Unifies the sitewide report queue, the
 * Answers forum queue, the Guild Queue, and an admin-only audit log.
 * Client-side gate redirects a non-mod/non-forum-mod to /home; the
 * underlying endpoints enforce auth server-side regardless.
 */

import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';
import { AdminCardSkeleton, AdminEmptyState, AdminToast, AdminTabs, timeAgo } from '@/components/admin/AdminUI';

type QueueKey = 'reports' | 'forum' | 'guild' | 'audit';
type StatusFilter = 'pending' | 'resolved' | 'escalated';

interface ReportItem {
  id: string;
  reporter_username: string | null;
  reported_user_username?: string | null;
  question_title?: string | null;
  answer_body?: string | null;
  guild_message_content?: string | null;
  guild_name?: string | null;
  report_type: string;
  status: string;
  ai_confidence?: number | null;
  duplicate_count?: number;
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

const PLATFORM_ACTIONS: { label: string; action: string; durationHours?: number }[] = [
  { label: 'Dismiss', action: 'dismiss' },
  { label: 'Warn', action: 'warn' },
  { label: 'Remove', action: 'remove_content' },
  { label: 'Suspend 24h', action: 'suspend_user', durationHours: 24 },
  { label: 'Suspend 7d', action: 'suspend_user', durationHours: 168 },
  { label: 'Ban', action: 'ban_user' },
  { label: 'Escalate to AI', action: 'escalate_ai' },
];

const GUILD_ACTIONS: { label: string; action: string; durationHours?: number }[] = [
  { label: 'Dismiss', action: 'dismiss' },
  { label: 'Warn', action: 'warn' },
  { label: 'Remove', action: 'remove_content' },
  { label: 'Mute 24h', action: 'mute_member', durationHours: 24 },
  { label: 'Kick', action: 'kick_member' },
];

async function fetchQueue(queue: QueueKey, status: StatusFilter): Promise<{ items: ReportItem[]; audit: AuditItem[] }> {
  if (queue === 'audit') {
    const { data } = await apiClient.get<{ items: AuditItem[] }>('/admin/moderation/audit');
    return { items: [], audit: data.items ?? [] };
  }
  const endpoint = queue === 'forum' ? '/admin/forum/queue' : queue === 'guild' ? '/guild-moderation' : '/admin/moderation';
  const { data } = await apiClient.get<{ items: ReportItem[] }>(`${endpoint}?status=${status}`);
  return { items: data.items ?? [], audit: [] };
}

async function fetchHasGuildScope(): Promise<boolean> {
  try {
    await apiClient.get('/guild-moderation?status=pending');
    return true;
  } catch {
    return false;
  }
}

function ModerationCenterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();

  const isAdmin = Boolean(user?.is_admin);
  const isPlatformMod = Boolean(user?.is_admin || user?.is_moderator);

  const { data: hasGuildScope } = useQuery({
    queryKey: ['moderation-center-guild-scope'],
    queryFn: fetchHasGuildScope,
    enabled: !!user,
  });
  const isMod = isPlatformMod || Boolean(hasGuildScope);

  if (user && hasGuildScope !== undefined && !isMod) {
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
    mutationFn: async ({ item, action, durationHours, markMalicious }: { item: ReportItem; action: string; durationHours?: number; markMalicious?: boolean }) => {
      const endpoint =
        queue === 'forum' ? `/admin/forum/queue/${item.id}/action`
        : queue === 'guild' ? `/guild-moderation/${item.id}/action`
        : `/admin/moderation/${item.id}/action`;
      await apiClient.post(endpoint, {
        action,
        ...(durationHours ? { duration_hours: durationHours } : {}),
        ...(markMalicious ? { mark_malicious: true } : {}),
      });
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
    ...(isPlatformMod ? [{ key: 'reports' as QueueKey, label: t('moderation.tab.reports', 'Reports') }] : []),
    ...(isPlatformMod ? [{ key: 'forum' as QueueKey, label: t('moderation.tab.forum', 'Forum Queue') }] : []),
    ...(hasGuildScope ? [{ key: 'guild' as QueueKey, label: t('moderation.tab.guild', 'Guild Queue') }] : []),
    ...(isAdmin ? [{ key: 'audit' as QueueKey, label: t('moderation.tab.audit', 'Audit Log') }] : []),
  ];
  const activeQueue = tabs.some((tb) => tb.key === queue) ? queue : (tabs[0]?.key ?? 'reports');
  const actions = activeQueue === 'guild' ? GUILD_ACTIONS : PLATFORM_ACTIONS;

  const items = data?.items ?? [];
  const auditItems = data?.audit ?? [];

  return (
    <div className="p-4">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('moderation.title', 'Moderation Center')}</h1>
      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <AdminTabs tabs={tabs} active={activeQueue} onChange={setQueue} />

      {activeQueue !== 'audit' && (
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
        ) : activeQueue === 'audit' ? (
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
            const title =
              activeQueue === 'forum' ? item.question_title ?? item.answer_body ?? '(forum content)'
              : activeQueue === 'guild' ? item.guild_message_content ?? '(guild content)'
              : item.reported_user_username ?? '(target)';
            return (
              <div key={item.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-neutral-700">@{item.reporter_username ?? 'unknown'}</span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold text-neutral-700">{item.report_type.replace(/_/g, ' ')}</span>
                  {item.guild_name && <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-700">{item.guild_name}</span>}
                  {!!item.duplicate_count && item.duplicate_count > 1 && (
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">{item.duplicate_count} reports</span>
                  )}
                  <span className="ml-auto text-neutral-400">{timeAgo(item.created_at)}</span>
                </div>
                <p className="mb-3 truncate text-sm text-neutral-700">{title}</p>
                {item.status === 'pending' ? (
                  <div className="flex flex-wrap gap-1.5">
                    {actions.map(({ label, action, durationHours }) => (
                      <button
                        key={label}
                        disabled={isBusy}
                        onClick={() => {
                          const markMalicious = action === 'dismiss' ? window.confirm(t('moderation.confirmMalicious', 'Was this report malicious or spammy? OK = yes, dock reporter Trust Score.')) : undefined;
                          actionMutation.mutate({ item, action, durationHours, markMalicious });
                        }}
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

export const Route = createFileRoute('/watch56')({
  component: ModerationCenterPage,
});
