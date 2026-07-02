/**
 * apps/android/src/routes/guild.tsx
 *
 * My Guild hub — mirrors apps/web/app/(app)/guild/page.tsx. Shows a
 * discovery panel of nearby/recommended guilds if the caller isn't in a
 * guild, or the full guild dashboard (tier progress, treasury, active war,
 * members, war history, alliance) if they are.
 *
 * CONTRACT FIX (see report): the web page used to call GET /api/guild/mine
 * and GET /api/guilds/nearby, neither of which exists server-side — the
 * dashboard never loaded on any platform. This mirrors the fixed web page's
 * pattern instead: GET /api/users/me for guild_id, then either
 * GET /api/guilds/discovery (no guild) or GET /api/guilds/:guildId (in a
 * guild) — the latter was also rewritten server-side to return the
 * isMember/isCaptain/tierXpRequired/activeWar/warHistory/allianceHistory/
 * activeQuests shape this page (and guilds/$guildId.tsx) needs.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';
import type { GuildDetail, GuildSummary } from '@/lib/guilds/types';
import { GuildDetailView, TIER_BADGE, tierBase } from '@/lib/guilds/GuildDetailView';

async function fetchMyGuildId(): Promise<string | null> {
  const { data } = await apiClient.get<{ user: { guild_id: string | null } }>('/users/me');
  return data.user.guild_id;
}

async function fetchDiscovery(): Promise<GuildSummary[]> {
  const { data } = await apiClient.get<{ data: { guilds: GuildSummary[] } }>('/guilds/discovery');
  return data.data.guilds ?? [];
}

async function fetchGuild(guildId: string): Promise<GuildDetail> {
  const { data } = await apiClient.get<{ data: GuildDetail }>(`/guilds/${guildId}`);
  return data.data;
}

function GuildDiscoveryPanel({ guilds, loading }: { guilds: GuildSummary[]; loading: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin(guildId: string) {
    setJoiningId(guildId);
    setError(null);
    try {
      await apiClient.post(`/guilds/${guildId}/join`);
      await qc.invalidateQueries({ queryKey: ['guild', 'mine'] });
    } catch {
      setError(t('error.generic'));
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="text-center">
        <h1 className="text-xl font-bold text-neutral-900">{t('guild.joinTitle')}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t('guild.joinSubtitle')}</p>
      </div>

      {error && <p className="text-center text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5">
              <div className="flex gap-4">
                <div className="h-12 w-12 rounded-full bg-neutral-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 w-32 rounded bg-neutral-200" />
                  <div className="h-3 w-48 rounded bg-neutral-200" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : guilds.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-10 text-center">
          <p className="text-4xl">🏛️</p>
          <p className="mt-3 text-sm text-neutral-500">{t('guildDiscovery.empty')}</p>
        </div>
      ) : (
        guilds.map((g) => {
          const { classes, label } = TIER_BADGE[tierBase(g.tier)];
          return (
            <div key={g.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-neutral-200 bg-white p-5">
              <Link to="/guilds/$guildId" params={{ guildId: g.id }}>
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-3xl">
                  {g.crestEmoji}
                </span>
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to="/guilds/$guildId" params={{ guildId: g.id }}>
                    <h3 className="font-bold text-neutral-900">{g.name}</h3>
                  </Link>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${classes}`}>{label}</span>
                </div>
                <p className="text-xs text-neutral-500">
                  {g.city ? `${g.city} · ` : ''}
                  {t('guildDiscovery.members', { count: g.memberCount })} · {t('guildDiscovery.warsWon', { count: g.warWins })}
                </p>
              </div>
              <button
                disabled={joiningId === g.id}
                onClick={() => handleJoin(g.id)}
                className="shrink-0 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {joiningId === g.id ? t('guildDiscovery.joining') : t('guildDiscovery.join')}
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

function MyGuildPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const { data: guildId, status: idStatus } = useQuery({
    queryKey: ['guild', 'mine'],
    queryFn: fetchMyGuildId,
  });

  const { data: discovery, status: discoveryStatus } = useQuery({
    queryKey: ['guilds', 'discovery'],
    queryFn: fetchDiscovery,
    enabled: idStatus === 'success' && !guildId,
  });

  const { data: guild, status: guildStatus, refetch } = useQuery({
    queryKey: ['guild', guildId],
    queryFn: () => fetchGuild(guildId as string),
    enabled: idStatus === 'success' && !!guildId,
  });

  async function handleLeave() {
    if (!user?.id || !guildId) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      await apiClient.delete(`/guilds/${guildId}/members`, { data: { userId: user.id } });
      await qc.invalidateQueries({ queryKey: ['guild', 'mine'] });
      await refetch();
    } catch {
      setLeaveError(t('error.generic'));
    } finally {
      setLeaving(false);
    }
  }

  if (idStatus === 'pending' || (guildId && guildStatus === 'pending')) {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-6 animate-pulse space-y-4">
        <div className="h-8 w-40 bg-neutral-200 rounded" />
        <div className="h-32 bg-neutral-200 rounded-xl" />
        <div className="h-48 bg-neutral-200 rounded-xl" />
      </div>
    );
  }

  if (idStatus === 'error' || (guildId && guildStatus === 'error')) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
        <button onClick={() => refetch()} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm">
          {t('android.error.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4">
      {guildId && guild ? (
        <GuildDetailView
          guild={guild}
          backTo="/guild"
          actions={
            <>
              {leaveError && <p className="mb-2 text-xs font-medium text-danger-600">{leaveError}</p>}
              <button
                onClick={handleLeave}
                disabled={leaving || guild.isCaptain}
                className="w-full rounded-xl border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60"
              >
                {leaving ? '…' : guild.isCaptain ? t('guild.captainLabel') : t('guild.leave')}
              </button>
            </>
          }
        />
      ) : (
        <GuildDiscoveryPanel guilds={discovery ?? []} loading={discoveryStatus === 'pending'} />
      )}
    </div>
  );
}

export const Route = createFileRoute('/guild')({
  component: MyGuildPage,
});
