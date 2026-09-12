/**
 * apps/android/src/components/home/NemesisCard.tsx
 *
 * Home Dashboard's compact Nemesis widget — mirrors
 * apps/web/components/home/NemesisCard.tsx. Fetches GET /api/nemesis (same
 * flat, non-{success,data,error}-wrapped payload consumed by the full
 * routes/nemesis.tsx page) and posts a challenge via POST
 * /nemesis/challenge (routes/nemesis.tsx's own confirmed-working endpoint).
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface NemesisParty {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  xp: number;
}

interface NemesisApiResponse {
  me: NemesisParty | null;
  nemesis: NemesisParty | null;
}

interface NemesisData {
  rivalUsername: string;
  rivalAvatarEmoji: string;
  myXP: number;
  rivalXP: number;
}

async function fetchNemesis(): Promise<NemesisData | null> {
  const { data } = await apiClient.get<NemesisApiResponse>('/nemesis');
  if (!data?.nemesis || !data?.me) return null;
  return {
    rivalUsername: data.nemesis.displayName || data.nemesis.username,
    rivalAvatarEmoji: data.nemesis.avatarEmoji,
    myXP: data.me.xp,
    rivalXP: data.nemesis.xp,
  };
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 ${className}`} />;
}

function NemesisSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <SkeletonBlock className="mb-3 h-4 w-24" />
      <div className="flex items-center gap-4">
        <SkeletonBlock className="h-12 w-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <SkeletonBlock className="h-4 w-32" />
          <SkeletonBlock className="h-2 w-full" />
        </div>
        <SkeletonBlock className="h-12 w-12 rounded-full" />
      </div>
      <SkeletonBlock className="mt-4 h-9 w-full rounded-xl" />
    </div>
  );
}

export function NemesisCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data: nemesis, isPending } = useQuery({ queryKey: ['home', 'nemesis'], queryFn: fetchNemesis });

  const challenge = useMutation({
    mutationFn: () => apiClient.post('/nemesis/challenge'),
    onError: () => setError(t('error.generic')),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['home', 'nemesis'] });
    },
  });

  if (isPending) return <NemesisSkeleton />;
  if (!nemesis) return null;

  const total = nemesis.myXP + nemesis.rivalXP;
  const myPct = total > 0 ? Math.round((nemesis.myXP / total) * 100) : 50;
  const ahead = nemesis.myXP >= nemesis.rivalXP;
  const diff = Math.abs(nemesis.myXP - nemesis.rivalXP);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('home.nemesis.title')}</h2>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 text-2xl">🧑</div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
            <span className="font-semibold text-primary-600">{t('home.nemesis.you')}</span>
            <span className="font-semibold text-red-600">@{nemesis.rivalUsername}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-red-100">
            <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${myPct}%` }} />
          </div>
          <p className="mt-1.5 text-center text-xs font-semibold text-neutral-600">
            {ahead ? (
              <span className="text-teal-600">{t('home.nemesis.ahead', { diff: diff.toLocaleString() })}</span>
            ) : (
              <span className="text-red-600">{t('home.nemesis.behind', { diff: diff.toLocaleString() })}</span>
            )}
          </p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl">{nemesis.rivalAvatarEmoji}</div>
      </div>
      <button
        type="button"
        onClick={() => challenge.mutate()}
        disabled={challenge.isPending}
        className="mt-4 w-full rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60"
      >
        {challenge.isPending ? t('home.nemesis.challenging') : t('home.nemesis.challenge')}
      </button>
    </div>
  );
}
