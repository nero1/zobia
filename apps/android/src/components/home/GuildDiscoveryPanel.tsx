/**
 * apps/android/src/components/home/GuildDiscoveryPanel.tsx
 *
 * Mirrors apps/web/components/home/GuildDiscoveryPanel.tsx (PRD §4 — shown
 * to users with no guild). Fetches GET /api/guilds/discovery, which itself
 * already returns an empty array for users already in a guild.
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface DiscoveryGuild {
  id: string;
  name: string;
  crestEmoji: string;
  tier: string;
  memberCount: number;
  warWins: number;
  city: string | null;
}

async function fetchDiscoveryGuilds(): Promise<DiscoveryGuild[]> {
  const { data } = await apiClient.get<{ guilds?: DiscoveryGuild[] }>('/guilds/discovery');
  return data?.guilds ?? [];
}

function GuildDiscoverySkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 h-4 w-40 rounded bg-neutral-200" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-neutral-200" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-28 rounded bg-neutral-200" />
              <div className="h-2.5 w-20 rounded bg-neutral-200" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GuildDiscoveryPanel() {
  const { t } = useTranslation();
  const { data: guilds, isPending } = useQuery({ queryKey: ['home', 'guilds', 'discovery'], queryFn: fetchDiscoveryGuilds });

  if (isPending) return <GuildDiscoverySkeleton />;
  if (!guilds || guilds.length === 0) return null;

  return (
    <div className="rounded-xl border border-primary-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700">{t('home.guildDiscovery.title')}</h2>
        <Link to="/guild" className="text-xs font-semibold text-primary-600">
          {t('home.guildDiscovery.seeAll')}
        </Link>
      </div>
      <div className="space-y-3">
        {guilds.map((guild) => (
          <div key={guild.id} className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xl">{guild.crestEmoji}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-900">{guild.name}</p>
              <p className="text-xs text-neutral-500">
                <span className="capitalize">{guild.tier.replace('_', ' ')}</span>
                {' · '}
                {guild.memberCount} members
                {(guild.warWins ?? 0) > 0 && ` · ${guild.warWins} wars won`}
                {guild.city && ` · ${guild.city}`}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Link
                to="/guilds/$guildId"
                params={{ guildId: guild.id }}
                className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-semibold text-neutral-700"
              >
                {t('home.guildDiscovery.view')}
              </Link>
              <Link to="/guild" className="rounded-lg bg-primary-600 px-2.5 py-1.5 text-xs font-semibold text-white">
                {t('home.guildDiscovery.join')}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
