/**
 * apps/android/src/components/profile/ProfileMoments.tsx
 *
 * Mirrors apps/web/components/profile/ProfileMoments.tsx — the profile
 * page's "Moments" tab (there is no "Tweets" feature in this codebase; see
 * the product-decision note in $username.tsx). Reuses GET /api/moments
 * filtered to this author via ?userId=.
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

export interface ProfileMoment {
  id: string;
  content: string;
  content_type: string;
  media_url: string | null;
  caption: string | null;
  created_at: string;
}

export async function fetchProfileMoments(userId: string): Promise<ProfileMoment[]> {
  const { data } = await apiClient.get<{ moments: ProfileMoment[] }>(
    `/moments?userId=${encodeURIComponent(userId)}&limit=5`
  );
  return data?.moments ?? [];
}

export function useProfileMomentsQuery(userId: string) {
  return useQuery({
    queryKey: ['profile-moments', userId],
    queryFn: () => fetchProfileMoments(userId),
    staleTime: 60_000,
    enabled: !!userId,
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function ProfileMoments({ moments, loading }: { moments: ProfileMoment[] | undefined; loading: boolean }) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-neutral-200" />
        ))}
      </div>
    );
  }

  if (!moments || moments.length === 0) {
    return <p className="py-6 text-center text-sm text-neutral-500">{t('profile.moments.empty', 'No moments yet')}</p>;
  }

  return (
    <div className="space-y-2">
      {moments.map((m) => (
        <div key={m.id} className="rounded-lg border border-neutral-200 px-3 py-2">
          {m.content && <p className="whitespace-pre-line text-sm text-neutral-800">{m.content}</p>}
          {m.media_url && <img src={m.media_url} alt={m.caption ?? ''} className="mt-2 max-h-48 rounded-md object-cover" />}
          <p className="mt-1 text-xs text-neutral-400">{timeAgo(m.created_at)}</p>
        </div>
      ))}
    </div>
  );
}
