/**
 * apps/android/src/components/profile/ActivityFeed.tsx
 *
 * Mirrors apps/web/components/profile/ActivityFeed.tsx — the profile
 * page's "Activities" tab, backed by GET /api/users/:userId/activity.
 * A 403 (ACTIVITIES_HIDDEN) means the owner has hidden this section from
 * this viewer — the tab must not render at all, not just be disabled.
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';

export interface ActivityItem {
  type: 'rank_up' | 'badge' | 'guild_join';
  emoji: string;
  label: string;
  occurredAt: string;
}

async function fetchActivity(userId: string): Promise<ActivityItem[]> {
  // The activity endpoint replies with a bare `{ activities }` body (like
  // the profile endpoint), not the `{success,data,error}` envelope, so read
  // response.data directly rather than the interceptor-unwrapped `data`.
  const res = await apiClient.get<{ activities: ActivityItem[] }>(`/users/${userId}/activity`);
  return res.data?.activities ?? [];
}

export function useProfileActivityQuery(userId: string) {
  const query = useQuery({
    queryKey: ['profile-activity', userId],
    queryFn: () => fetchActivity(userId),
    staleTime: 60_000,
    retry: false,
    enabled: !!userId,
  });
  const forbidden = (query.error as AxiosError | null)?.response?.status === 403;
  return { ...query, forbidden };
}

export function ActivityFeed({ activities, loading }: { activities: ActivityItem[] | undefined; loading: boolean }) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-neutral-200" />
        ))}
      </div>
    );
  }

  if (!activities || activities.length === 0) {
    return <p className="py-6 text-center text-sm text-neutral-500">{t('profile.activities.empty', 'No activity yet')}</p>;
  }

  return (
    <ul className="space-y-2">
      {activities.map((a, i) => (
        <li key={`${a.type}-${a.occurredAt}-${i}`} className="flex items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2">
          <span className="text-lg">{a.emoji}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-neutral-700">{a.label}</span>
          <span className="shrink-0 text-xs text-neutral-400">{new Date(a.occurredAt).toLocaleDateString()}</span>
        </li>
      ))}
    </ul>
  );
}
