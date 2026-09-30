/**
 * apps/android/src/components/portals/FollowPortalButton.tsx
 *
 * Mirrors apps/web/components/portals/FollowPortalButton.tsx: follow/unfollow
 * a portal with an optimistic toggle. Viewer state is a separate query from
 * the (cached, viewer-independent) portal payload.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

export function FollowPortalButton({ slug, onCountChange }: { slug: string; onCountChange?: (count: number) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['portals', 'follow', slug];

  const { data } = useQuery({
    queryKey: key,
    queryFn: async () => (await apiClient.get<{ following: boolean }>(`/portals/${encodeURIComponent(slug)}/follow`)).data,
  });

  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      const res = next
        ? await apiClient.post<{ followerCount: number }>(`/portals/${encodeURIComponent(slug)}/follow`)
        : await apiClient.delete<{ followerCount: number }>(`/portals/${encodeURIComponent(slug)}/follow`);
      return res.data;
    },
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<{ following: boolean }>(key);
      qc.setQueryData(key, { following: next });
      return { prev };
    },
    onError: (_e, _n, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: (d) => {
      if (typeof d?.followerCount === 'number') onCountChange?.(d.followerCount);
      void qc.invalidateQueries({ queryKey: ['portals', 'following'] });
    },
  });

  const following = !!data?.following;
  return (
    <button
      type="button"
      onClick={() => toggle.mutate(!following)}
      disabled={data === undefined || toggle.isPending}
      aria-pressed={following}
      className={`rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-60 ${
        following
          ? 'border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-200'
          : 'bg-primary-600 text-white'
      }`}
    >
      {following ? t('portals.following') : t('portals.follow')}
    </button>
  );
}
