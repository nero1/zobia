/**
 * apps/android/src/routes/stats.tsx
 *
 * User Profile Stats screen — mirrors the web/PWA Stats page
 * (apps/web/app/(app)/profile/[userId]/stats/page.tsx) as closely as
 * possible. Shows the logged-in user's own stats: badges, levels,
 * achievements, created rooms, leaderboard positions, guild, and social
 * counts. Loaded only when the user navigates here from Wallet or Settings.
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';

interface TrackStat { track: string; label: string; emoji: string; level: number; xp: number }
interface BadgeStat { key: string; label: string; grantedAt: string }
interface CreatedRoom { id: string; name: string; coverEmoji: string; memberCount: number }
interface LeaderboardRow { track: string; globalRank: number | null; cityRank: number | null; guildRank: number | null; seasonRank: number | null }

interface StatsResponse {
  tier: 'basic' | 'full';
  isOwnStats: boolean;
  profile: {
    displayName: string;
    username: string | null;
    avatarEmoji: string;
    isCreator: boolean;
    rankName: string;
    rankSublevel: number;
    xpTotal: number;
    legacyScore: number;
    prestigeCount: number;
  };
  tracks: TrackStat[];
  badges: BadgeStat[];
  guild: { id: string | null; name: string; crestEmoji: string; tier: string } | null;
  social: { friendsCount: number; followersCount: number; followingCount: number; referralsCount: number };
  createdRooms: CreatedRoom[];
  leaderboard: LeaderboardRow[];
}

async function fetchStats(userId: string) {
  const { data } = await apiClient.get<StatsResponse>(`/users/${userId}/stats`);
  return data;
}

function TrackBar({ track }: { track: TrackStat }) {
  const pct = Math.min(100, Math.round(((track.xp % 1000) / 1000) * 100));
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-5 text-center">{track.emoji}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-neutral-700">{track.label}</span>
          <span className="text-xs font-semibold text-neutral-500">Lv {track.level}</span>
        </div>
        <div className="h-1.5 rounded-full bg-neutral-200 overflow-hidden">
          <div className="h-full rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

function CountTile({ label, value, emoji }: { label: string; value: number; emoji: string }) {
  return (
    <div className="bg-white rounded-xl p-3 text-center">
      <p className="text-lg">{emoji}</p>
      <p className="text-base font-bold text-neutral-900">{value.toLocaleString()}</p>
      <p className="text-xs text-neutral-500">{label}</p>
    </div>
  );
}

function StatsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const { data: stats, status } = useQuery({
    queryKey: ['stats', user?.id],
    queryFn: () => fetchStats(user!.id),
    enabled: Boolean(user?.id),
  });

  if (status === 'pending') {
    return (
      <div className="h-full bg-neutral-50 animate-pulse px-6 pt-6 space-y-3">
        <div className="h-24 bg-white rounded-xl" />
        <div className="h-24 bg-white rounded-xl" />
        <div className="h-24 bg-white rounded-xl" />
      </div>
    );
  }

  if (status === 'error' || !stats) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
        <p className="text-neutral-500 text-sm">{t('profile.stats.notFound')}</p>
      </div>
    );
  }

  const { profile } = stats;
  const subLabel = `${profile.rankName} ${['I', 'II', 'III'][profile.rankSublevel - 1] ?? 'I'}`;
  const mainRank = stats.leaderboard.find((r) => r.track === 'main');

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-4 pb-2">
        <h1 className="text-xl font-bold text-neutral-900">{t('profile.stats.title')}</h1>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${stats.tier === 'full' ? 'bg-gold-100 text-gold-700' : 'bg-neutral-100 text-neutral-600'}`}>
          {stats.tier === 'full' ? t('profile.stats.tierFull') : t('profile.stats.tierBasic')}
        </span>
      </div>

      {/* Profile summary */}
      <div className="bg-white px-6 py-4 mb-3 flex items-center gap-3">
        <div className="w-14 h-14 rounded-full bg-primary-100 flex items-center justify-center text-3xl">
          {profile.avatarEmoji}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-neutral-900">
            {profile.displayName} {profile.prestigeCount > 0 && <span className="text-amber-500">{'★'.repeat(Math.min(profile.prestigeCount, 5))}</span>}
          </p>
          <p className="text-sm text-neutral-500">@{profile.username ?? '—'}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="rounded-full bg-primary-600 px-2 py-0.5 text-xs font-bold text-white">{subLabel}</span>
            <span className="text-xs text-neutral-500">{profile.xpTotal.toLocaleString()} XP</span>
            {mainRank?.globalRank && <span className="text-xs text-primary-600">🌍 #{mainRank.globalRank}</span>}
          </div>
        </div>
      </div>

      {stats.tier === 'basic' && stats.isOwnStats && (
        <Link to="/settings" className="flex items-center gap-3 bg-gold-50 mx-6 mb-3 rounded-xl p-4">
          <span className="text-2xl">⚡</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gold-700">{t('profile.stats.unlockFull')}</p>
            <p className="text-xs text-gold-600">{t('profile.stats.unlockFullDesc')}</p>
          </div>
        </Link>
      )}

      {/* Progression tracks */}
      <div className="bg-white px-6 py-4 mb-3">
        <h2 className="text-sm font-semibold text-neutral-700 mb-2">{t('profile.progressionTracks')}</h2>
        {stats.tracks.map((tr) => <TrackBar key={tr.track} track={tr} />)}
      </div>

      {/* Social counts */}
      <div className="grid grid-cols-4 gap-2 px-6 mb-3">
        <CountTile label={t('profile.stats.friends')} value={stats.social.friendsCount} emoji="🤝" />
        <CountTile label={t('profile.followers')} value={stats.social.followersCount} emoji="👥" />
        <CountTile label={t('profile.following')} value={stats.social.followingCount} emoji="➡️" />
        <CountTile label={t('profile.stats.referrals')} value={stats.social.referralsCount} emoji="🔗" />
      </div>

      {/* Badges */}
      <div className="bg-white px-6 py-4 mb-3">
        <h2 className="text-sm font-semibold text-neutral-700 mb-2">
          🏆 {t('profile.stats.badgesAchievements')} ({stats.badges.length})
        </h2>
        {stats.badges.length === 0 ? (
          <p className="text-sm text-neutral-500">{t('profile.stats.noBadges')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {stats.badges.map((b) => (
              <span key={b.key} className="rounded-full bg-gold-50 border border-gold-200 px-3 py-1 text-xs font-semibold text-gold-700 capitalize">
                {b.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Created rooms */}
      {profile.isCreator && stats.createdRooms.length > 0 && (
        <div className="bg-white px-6 py-4 mb-3">
          <h2 className="text-sm font-semibold text-neutral-700 mb-2">🎨 {t('profile.stats.createdRooms')} ({stats.createdRooms.length})</h2>
          <div className="space-y-2">
            {stats.createdRooms.map((room) => (
              <Link key={room.id} to="/rooms/$roomId" params={{ roomId: room.id }} className="flex items-center gap-3 rounded-lg border border-neutral-100 p-3">
                <span className="text-xl">{room.coverEmoji}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800">{room.name}</span>
                <span className="shrink-0 text-xs text-neutral-500">👥 {room.memberCount.toLocaleString()}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Guild */}
      {stats.guild && (
        <div className="bg-white px-6 py-4 mb-3 flex items-center gap-3">
          <span className="text-2xl">{stats.guild.crestEmoji}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-neutral-900">{stats.guild.name}</p>
            <p className="text-xs text-neutral-500 capitalize">{stats.guild.tier.replace(/_/g, ' ')} Guild</p>
          </div>
        </div>
      )}

      {/* Leaderboard — full tier only */}
      {stats.tier === 'full' && (
        <div className="bg-white px-6 py-4 mb-6">
          <h2 className="text-sm font-semibold text-neutral-700 mb-2">🏅 {t('profile.stats.leaderboardPositions')}</h2>
          <div className="space-y-1.5">
            {stats.leaderboard.map((row) => (
              <div key={row.track} className="flex items-center justify-between text-sm py-1">
                <span className="capitalize text-neutral-700">{row.track}</span>
                <span className="text-neutral-500 tabular-nums">
                  {row.globalRank ? `#${row.globalRank}` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/stats')({
  component: StatsPage,
});
