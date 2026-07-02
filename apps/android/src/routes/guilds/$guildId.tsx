/**
 * apps/android/src/routes/guilds/$guildId.tsx
 *
 * Public guild profile — mirrors apps/web/app/(app)/guilds/[guildId]/page.tsx.
 * GET /api/guilds/:guildId (see the contract fix noted in guild.tsx);
 * join via POST /api/guilds/:guildId/join, leave via
 * DELETE /api/guilds/:guildId/members with { userId: <self> }.
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';
import type { GuildDetail } from '@/lib/guilds/types';
import { GuildDetailView } from '@/lib/guilds/GuildDetailView';

async function fetchGuild(guildId: string): Promise<GuildDetail> {
  const { data } = await apiClient.get<{ data: GuildDetail }>(`/guilds/${guildId}`);
  return data.data;
}

function GuildProfilePage() {
  const { t } = useTranslation();
  const { guildId } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [actionPending, setActionPending] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const { data: guild, status, refetch } = useQuery({
    queryKey: ['guild', guildId],
    queryFn: () => fetchGuild(guildId),
  });

  async function handleJoin() {
    setActionPending(true);
    setActionMsg(null);
    try {
      await apiClient.post(`/guilds/${guildId}/join`);
      await refetch();
      await qc.invalidateQueries({ queryKey: ['guild', 'mine'] });
    } catch {
      setActionMsg(t('error.generic'));
    } finally {
      setActionPending(false);
    }
  }

  async function handleLeave() {
    if (!user?.id) return;
    setActionPending(true);
    setActionMsg(null);
    try {
      await apiClient.delete(`/guilds/${guildId}/members`, { data: { userId: user.id } });
      await refetch();
      await qc.invalidateQueries({ queryKey: ['guild', 'mine'] });
    } catch {
      setActionMsg(t('error.generic'));
    } finally {
      setActionPending(false);
    }
  }

  if (status === 'pending') {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-6 animate-pulse space-y-4">
        <div className="h-32 bg-neutral-200 rounded-xl" />
        <div className="h-48 bg-neutral-200 rounded-xl" />
      </div>
    );
  }

  if (status === 'error' || !guild) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
        <span className="text-5xl">🏰</span>
        <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
        <button onClick={() => refetch()} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm">
          {t('android.error.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4">
      <GuildDetailView
        guild={guild}
        backTo="/guild"
        actions={
          <>
            {actionMsg && <p className="mb-2 text-xs font-medium text-danger-600">{actionMsg}</p>}
            {guild.isMember ? (
              <button
                onClick={handleLeave}
                disabled={actionPending || guild.isCaptain}
                className="w-full rounded-xl border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60"
              >
                {actionPending ? '…' : guild.isCaptain ? t('guild.captainLabel') : t('guild.leave')}
              </button>
            ) : guild.isOpenToJoin ? (
              <button
                onClick={handleJoin}
                disabled={actionPending}
                className="w-full rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {actionPending ? t('guildDiscovery.joining') : t('guild.join')}
              </button>
            ) : (
              <span className="block w-full rounded-xl border border-neutral-300 px-5 py-2.5 text-center text-sm font-semibold text-neutral-400">
                {guild.recruitmentMode === 'invite_only' ? t('guild.inviteOnly') : t('guild.applicationRequired')}
              </span>
            )}
          </>
        }
      />
    </div>
  );
}

export const Route = createFileRoute('/guilds/$guildId')({
  component: GuildProfilePage,
});
