/**
 * apps/android/src/routes/guild-discovery.tsx
 *
 * Guild Discovery — onboarding recommendation page, mirrors
 * apps/web/app/(app)/guild-discovery/page.tsx. Recommends up to 3 guilds
 * based on the authenticated user's city via GET /api/guilds/discovery.
 * Linked from /guilds ("see recommendations near you") and reachable
 * directly at /guild-discovery (e.g. after the guild_discovery CRON
 * notification, matching web/Expo).
 *
 * Distinct from /guild's own inline "no guild yet" panel (a lighter list
 * shown as part of the dashboard) and from /guilds (the full searchable
 * directory) — this is the richer, dedicated onboarding view with tier XP
 * boost badges, a "Near you" badge, a solo-play note, and a "too new"
 * empty state, none of which the other two screens render.
 */

import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import type { GuildSummary } from '@/lib/guilds/types';
import { TIER_BADGE, tierBase } from '@/lib/guilds/GuildDetailView';

interface DiscoveryData {
  guilds: GuildSummary[];
  userCity: string | null;
  guildEmphasis: 'guild' | 'solo' | null;
  soloNote: string | null;
  tooNew?: boolean;
}

const TIER_XP_BOOST: Record<string, number> = {
  bronze: 5,
  silver: 10,
  gold: 20,
  platinum: 30,
  legend: 50,
};

async function fetchDiscovery(): Promise<DiscoveryData> {
  const { data } = await apiClient.get<DiscoveryData>('/guilds/discovery');
  return {
    guilds: data?.guilds ?? [],
    userCity: data?.userCity ?? null,
    guildEmphasis: data?.guildEmphasis ?? null,
    soloNote: data?.soloNote ?? null,
    tooNew: data?.tooNew ?? false,
  };
}

async function joinGuild(guildId: string): Promise<void> {
  await apiClient.post(`/guilds/${guildId}/join`);
}

function GuildCard({
  guild,
  joinedId,
  joiningId,
  onJoin,
}: {
  guild: GuildSummary;
  joinedId: string | null;
  joiningId: string | null;
  onJoin: (id: string) => void;
}) {
  const { t } = useTranslation();
  const isJoined = joinedId === guild.id;
  const isJoining = joiningId === guild.id;
  const anyJoined = joinedId !== null;
  const base = tierBase(guild.tier);
  const xpBoost = TIER_XP_BOOST[base] ?? 5;
  const { classes: tierClasses, label: tierLabel } = TIER_BADGE[base];

  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        isJoined ? 'border-teal-400 bg-teal-50' : 'border-neutral-200 bg-white'
      }`}
    >
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-neutral-100 text-3xl">
          {guild.crestEmoji}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-bold text-neutral-900">{guild.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${tierClasses}`}>
              {tierLabel}
            </span>
          </div>

          {guild.city && (
            <p className="mt-0.5 text-xs text-neutral-500">
              📍 {guild.city}
              {guild.sameCity && (
                <span className="ml-1.5 rounded-full bg-primary-100 px-1.5 py-0.5 text-xs font-semibold text-primary-700">
                  {t('guildDiscovery.nearYou')}
                </span>
              )}
            </p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <span>{t('guildDiscovery.members', { count: guild.memberCount ?? 0 })}</span>
            {guild.warWins > 0 && <span>· {t('guildDiscovery.warsWon', { count: guild.warWins })}</span>}
            <span className="rounded-full bg-primary-50 px-2 py-0.5 font-semibold text-primary-700">
              {t('guildDiscovery.xpBoost', { pct: xpBoost })}
            </span>
          </div>

          {guild.description && <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{guild.description}</p>}
        </div>

        <div className="shrink-0">
          {isJoined ? (
            <span className="rounded-xl bg-teal-100 px-4 py-2 text-sm font-bold text-teal-700">
              {t('guildDiscovery.joined')}
            </span>
          ) : (
            <button
              onClick={() => onJoin(guild.id)}
              disabled={isJoining || anyJoined}
              className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isJoining ? t('guildDiscovery.joining') : t('guildDiscovery.join')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function GuildCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 shrink-0 rounded-2xl bg-neutral-200" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-36 rounded bg-neutral-200" />
          <div className="h-3 w-24 rounded bg-neutral-200" />
          <div className="h-3 w-48 rounded bg-neutral-200" />
        </div>
        <div className="h-9 w-16 rounded-xl bg-neutral-200" />
      </div>
    </div>
  );
}

function GuildDiscoveryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [joinedId, setJoinedId] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const { data, status, refetch } = useQuery({
    queryKey: ['guilds', 'discovery', 'onboarding'],
    queryFn: fetchDiscovery,
    staleTime: 120_000,
  });

  const joinMutation = useMutation({
    mutationFn: joinGuild,
    onMutate: (guildId: string) => {
      setJoiningId(guildId);
      setJoinError(null);
    },
    onSuccess: (_data, guildId) => {
      setJoinedId(guildId);
      setJoiningId(null);
      void qc.invalidateQueries({ queryKey: ['guilds'] });
      void qc.invalidateQueries({ queryKey: ['guild'] });
    },
    onError: () => {
      setJoiningId(null);
      setJoinError(t('error.generic'));
    },
  });

  const guilds = data?.guilds?.slice(0, 3) ?? [];

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      <div className="mx-auto max-w-xl space-y-5 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">
            {t('guildDiscovery.stepBadge')}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold text-neutral-900">{t('guildDiscovery.title')}</h1>
          <p className="mt-1.5 text-sm text-neutral-600">{t('guildDiscovery.subtitle')}</p>
          {data?.userCity && (
            <p className="mt-1 text-xs text-neutral-400">
              {t('guildDiscovery.nearCity', { city: data.userCity })}
            </p>
          )}
        </div>

        {data?.soloNote && (
          <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
            💡 {data.soloNote}
          </div>
        )}

        {data?.tooNew && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-center">
            <p className="text-2xl">⏳</p>
            <p className="mt-2 font-semibold text-amber-800">{t('guildDiscovery.tooNew')}</p>
            <p className="mt-1 text-sm text-amber-700">{t('guildDiscovery.tooNewBody')}</p>
          </div>
        )}

        {status === 'pending' ? (
          <>
            <GuildCardSkeleton />
            <GuildCardSkeleton />
            <GuildCardSkeleton />
          </>
        ) : status === 'error' ? (
          <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-5 text-center">
            <p className="text-sm text-danger-700">{t('guildDiscovery.error')}</p>
            <button
              onClick={() => void refetch()}
              className="mt-3 rounded-lg border border-danger-300 px-4 py-2 text-sm font-medium text-danger-700"
            >
              {t('guildDiscovery.retry')}
            </button>
          </div>
        ) : !data?.tooNew && guilds.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white px-4 py-10 text-center">
            <p className="text-4xl">🏛️</p>
            <p className="mt-3 font-semibold text-neutral-900">{t('guildDiscovery.empty')}</p>
            <p className="mt-1 text-sm text-neutral-500">
              {t('guildDiscovery.emptyHint')}{' '}
              <Link to="/guilds" className="text-primary-600 hover:underline">
                {t('guildDiscovery.browseAll')}
              </Link>
            </p>
          </div>
        ) : (
          guilds.map((guild) => (
            <GuildCard
              key={guild.id}
              guild={guild}
              joinedId={joinedId}
              joiningId={joiningId}
              onJoin={(id) => joinMutation.mutate(id)}
            />
          ))
        )}

        {joinError && (
          <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
            {joinError}
          </div>
        )}

        {!data?.tooNew && (
          <div className="flex flex-col gap-3 pt-2 sm:flex-row">
            <button
              onClick={() => navigate({ to: '/home' })}
              className={`flex-1 rounded-xl px-5 py-3 text-sm font-semibold ${
                joinedId ? 'bg-primary-600 text-white' : 'border border-neutral-300 bg-white text-neutral-700'
              }`}
            >
              {joinedId ? t('guildDiscovery.continueHome') : t('guildDiscovery.exploreOwn')}
            </button>
            {!joinedId && (
              <Link
                to="/guilds"
                className="flex-1 rounded-xl border border-primary-200 bg-primary-50 px-5 py-3 text-center text-sm font-semibold text-primary-700"
              >
                {t('guildDiscovery.browseAll')}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/guild-discovery')({
  component: GuildDiscoveryPage,
});
