/**
 * apps/android/src/routes/guilds/index.tsx
 *
 * Browse Guilds directory — mirrors the fixed apps/web/app/(app)/guilds/page.tsx
 * (GET /api/guilds, city filter, cursor pagination). Web's /guild-discovery
 * ("Crews near you are recruiting", 3 recommendations) is the onboarding
 * variant; this is the full searchable directory it links out to.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { TIER_BADGE, tierBase } from '@/lib/guilds/GuildDetailView';

interface GuildRow {
  id: string;
  name: string;
  crest_emoji: string;
  city: string | null;
  tier: string;
  member_count: number;
  recruitment_type: string;
  wars_won: number;
}

interface GuildsPage {
  items: GuildRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

async function fetchGuilds({ pageParam, city }: { pageParam?: string; city: string }): Promise<GuildsPage> {
  const params = new URLSearchParams({ limit: '20' });
  if (city.trim()) params.set('city', city.trim());
  if (pageParam) params.set('cursor', pageParam);
  const { data } = await apiClient.get<{ data: GuildsPage }>(`/guilds?${params.toString()}`);
  return data.data;
}

function GuildsIndexPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [city, setCity] = useState('');
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const { data, status, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['guilds', 'browse', city],
    queryFn: ({ pageParam }) => fetchGuilds({ pageParam, city }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const guilds = data?.pages.flatMap((p) => p.items) ?? [];

  async function handleJoin(guildId: string) {
    setJoiningId(guildId);
    try {
      await apiClient.post(`/guilds/${guildId}/join`);
      await qc.invalidateQueries({ queryKey: ['guild', 'mine'] });
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-3">
      <input
        type="text"
        value={city}
        onChange={(e) => setCity(e.target.value)}
        placeholder={t('guilds.filterByCity')}
        className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:outline-none"
        data-selectable
      />

      {status === 'pending' ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-neutral-200 bg-white" />
          ))}
        </div>
      ) : status === 'error' ? (
        <p className="py-8 text-center text-sm text-danger-600">{t('error.generic')}</p>
      ) : guilds.length === 0 ? (
        <p className="py-12 text-center text-sm text-neutral-500">{t('guildDiscovery.empty')}</p>
      ) : (
        <>
          {guilds.map((g) => {
            const { classes } = TIER_BADGE[tierBase(g.tier)];
            return (
              <div key={g.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4">
                <Link to="/guilds/$guildId" params={{ guildId: g.id }}>
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-2xl">{g.crest_emoji}</span>
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to="/guilds/$guildId" params={{ guildId: g.id }} className="font-bold text-neutral-900">
                      {g.name}
                    </Link>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${classes}`}>{g.tier.split('_')[0]}</span>
                  </div>
                  <p className="text-xs text-neutral-500">
                    {g.city ? `${g.city} · ` : ''}
                    {t('guildDiscovery.members', { count: g.member_count })} · {t('guildDiscovery.warsWon', { count: g.wars_won })}
                  </p>
                </div>
                <button
                  disabled={joiningId === g.id || g.recruitment_type === 'invite_only'}
                  onClick={() => handleJoin(g.id)}
                  className="shrink-0 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {joiningId === g.id ? t('guildDiscovery.joining') : t('guildDiscovery.join')}
                </button>
              </div>
            );
          })}

          {hasNextPage && (
            <div className="flex justify-center py-3">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="rounded-xl border border-neutral-300 px-5 py-2 text-xs font-semibold text-neutral-700 disabled:opacity-60"
              >
                {isFetchingNextPage ? t('wallet.loadingMore') : t('wallet.loadMore')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/guilds/')({
  component: GuildsIndexPage,
});
