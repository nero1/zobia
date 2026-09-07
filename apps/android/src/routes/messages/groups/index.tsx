/**
 * apps/android/src/routes/messages/groups/index.tsx
 *
 * Group chats list — mirrors apps/web/app/(app)/messages/groups/page.tsx.
 * GET /api/messages/group for the list, GET /api/messages/group/deactivated
 * for the renewal-time reactivation prompt.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { PullToRefresh } from '@/components/ui/PullToRefresh';

interface GroupChat {
  id: string;
  name: string;
  avatar_emoji: string;
  tag: string | null;
  member_count: number;
  max_members: number;
  last_message_at: string;
  user_role: string;
}

interface DeactivatedGroup {
  id: string;
  name: string;
  avatar_emoji: string;
  member_count: number;
  deactivated_at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

async function fetchGroups(): Promise<GroupChat[]> {
  const { data } = await apiClient.get<{ items?: GroupChat[] }>('/messages/group');
  return data.items ?? [];
}

async function fetchDeactivatedGroups(): Promise<DeactivatedGroup[]> {
  const { data } = await apiClient.get<{ data?: DeactivatedGroup[] }>('/messages/group/deactivated');
  return data.data ?? [];
}

function GroupsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { data: groups, status, refetch } = useQuery({
    queryKey: ['messages', 'groups'],
    queryFn: fetchGroups,
    staleTime: 30_000,
  });

  const { data: deactivatedGroups } = useQuery({
    queryKey: ['messages', 'groups', 'deactivated'],
    queryFn: fetchDeactivatedGroups,
    staleTime: 60_000,
  });

  const visibleDeactivated = (deactivatedGroups ?? []).filter((g) => !dismissed.has(g.id));

  async function handleReactivate(groupId: string) {
    setReactivatingId(groupId);
    try {
      await apiClient.post(`/messages/group/${groupId}/reactivate`);
      setDismissed((prev) => new Set(prev).add(groupId));
      void qc.invalidateQueries({ queryKey: ['messages', 'groups'] });
    } catch {
      /* non-fatal — user can retry */
    } finally {
      setReactivatingId(null);
    }
  }

  async function handleDismiss(groupId: string) {
    setDismissed((prev) => new Set(prev).add(groupId));
    try {
      await apiClient.post(`/messages/group/${groupId}/reactivate`, { reactivate: false });
    } catch {
      /* non-fatal — worst case the prompt resurfaces next visit */
    }
  }

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
        <h1 className="text-lg font-bold text-neutral-900">{t('messages.groupsList.title')}</h1>
        <button
          onClick={() => navigate({ to: '/messages/groups/create' })}
          className="rounded-full bg-primary-600 px-4 py-2 text-xs font-semibold text-white"
        >
          {t('messages.groupsList.createGroup')}
        </button>
      </div>

      {visibleDeactivated.length > 0 && (
        <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-semibold text-amber-800">{t('messages.groupsList.reactivationPrompt')}</p>
          <div className="space-y-2">
            {visibleDeactivated.map((g) => (
              <div key={g.id} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-2">
                <span className="text-lg">{g.avatar_emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-neutral-900">{g.name}</p>
                  <p className="text-[11px] text-neutral-400">{t('messages.groupChat.memberCount', { count: g.member_count })}</p>
                </div>
                <button
                  onClick={() => void handleReactivate(g.id)}
                  disabled={reactivatingId === g.id}
                  className="rounded-lg bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                >
                  {t('messages.groupsList.reactivate')}
                </button>
                <button
                  onClick={() => void handleDismiss(g.id)}
                  className="rounded-lg border border-neutral-300 px-2.5 py-1 text-[11px] font-semibold text-neutral-600"
                >
                  {t('messages.groupsList.keepDeactivated')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <PullToRefresh onRefresh={() => refetch()} className="flex-1 overflow-y-auto">
        {status === 'pending' && (
          <div className="divide-y divide-neutral-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-4 animate-pulse">
                <div className="w-11 h-11 rounded-full bg-neutral-200" />
                <div className="flex-1">
                  <div className="h-4 bg-neutral-200 rounded w-32 mb-2" />
                  <div className="h-3 bg-neutral-100 rounded w-24" />
                </div>
              </div>
            ))}
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <p className="text-neutral-500 text-sm">{t('messages.groupsList.loadError')}</p>
            <button onClick={() => refetch()} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm">
              {t('android.error.retry')}
            </button>
          </div>
        )}

        {status === 'success' && groups?.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 px-6 text-center">
            <span className="text-4xl">👥</span>
            <p className="text-sm font-semibold text-neutral-700">{t('messages.groupsList.empty')}</p>
            <p className="text-xs text-neutral-400">{t('messages.groupsList.emptyHint')}</p>
            <Link
              to="/messages/groups/create"
              className="mt-2 inline-block rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white"
            >
              {t('messages.groupsList.createGroup')}
            </Link>
          </div>
        )}

        {groups?.map((group) => (
          <Link
            key={group.id}
            to="/messages/groups/$groupId"
            params={{ groupId: group.id }}
            className="flex items-center gap-3 px-4 py-4 border-b border-neutral-100 active:bg-neutral-50"
          >
            <div className="w-11 h-11 rounded-full bg-primary-100 flex items-center justify-center text-xl">
              {group.avatar_emoji}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-neutral-900 text-sm truncate">{group.name}</p>
                <p className="text-[11px] text-neutral-400 shrink-0">{timeAgo(group.last_message_at)}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <p className="text-xs text-neutral-500">{t('messages.groupChat.memberCount', { count: group.member_count })}</p>
                {group.tag && (
                  <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">{group.tag}</span>
                )}
                {group.user_role === 'admin' && (
                  <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                    {t('messages.groupChat.members.admin')}
                  </span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </PullToRefresh>
    </div>
  );
}

export const Route = createFileRoute('/messages/groups/')({
  component: GroupsPage,
});
