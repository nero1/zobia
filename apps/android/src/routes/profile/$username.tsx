/**
 * apps/android/src/routes/profile/$username.tsx
 *
 * User profile view. GET /api/users/:username.
 */

import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import type { PublicProfile } from '@zobia/shared/types';

async function fetchProfile(username: string) {
  const { data } = await apiClient.get<PublicProfile>(`/users/${username}`);
  return data;
}

function ProfilePage() {
  const { t } = useTranslation();
  const { username } = Route.useParams();

  const { data: profile, status } = useQuery({
    queryKey: ['profile', username],
    queryFn: () => fetchProfile(username),
    staleTime: 5 * 60_000,
  });

  if (status === 'pending') {
    return (
      <div className="h-full bg-white animate-pulse px-6 pt-8">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-20 h-20 rounded-full bg-neutral-200" />
          <div className="h-5 bg-neutral-200 rounded w-32" />
          <div className="h-4 bg-neutral-100 rounded w-24" />
        </div>
      </div>
    );
  }

  if (status === 'error' || !profile) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <p className="text-neutral-500 text-sm">{t('profile.notFound')}</p>
      </div>
    );
  }

  const joinedYear = new Date(profile.createdAt).getFullYear();

  return (
    <div className="h-full overflow-y-auto bg-white">
      {/* Hero */}
      <div className="px-6 pt-8 pb-6 border-b border-neutral-100">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-20 h-20 rounded-full bg-primary-100 flex items-center justify-center text-4xl">
            {profile.avatarEmoji || '👤'}
          </div>
          <div>
            <h2 className="text-xl font-bold text-neutral-900">{profile.displayName}</h2>
            <p className="text-neutral-500 text-sm">@{profile.username}</p>
          </div>

          {profile.bio && (
            <p className="text-neutral-700 text-sm mt-1 max-w-xs">{profile.bio}</p>
          )}

          <div className="flex items-center gap-2 text-xs text-neutral-400 mt-1">
            <span>{t('profile.joinedOn', { date: joinedYear })}</span>
            {profile.city && <><span>·</span><span>{profile.city}</span></>}
          </div>

          <div className="flex items-center gap-2 mt-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              profile.plan === 'free' ? 'bg-neutral-100 text-neutral-600' :
              profile.plan === 'plus' ? 'bg-primary-100 text-primary-700' :
              profile.plan === 'pro' ? 'bg-gold-100 text-gold-700' :
              'bg-purple-100 text-purple-700'
            }`}>
              {profile.plan === 'free' ? t('profile.freePlan') : t('profile.plan', { plan: profile.plan })}
            </span>
            {profile.isVerified && (
              <span className="text-xs text-primary-600 font-medium">{t('profile.verified')}</span>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 divide-x divide-neutral-100 border-b border-neutral-100">
        <div className="px-4 py-4 text-center">
          <p className="text-lg font-bold text-neutral-900">{profile.xpTotal.toLocaleString()}</p>
          <p className="text-xs text-neutral-500">XP</p>
        </div>
        <div className="px-4 py-4 text-center">
          <p className="text-lg font-bold text-neutral-900">{profile.rankName}</p>
          <p className="text-xs text-neutral-500">{t('profile.rank')}</p>
        </div>
        <div className="px-4 py-4 text-center">
          <p className="text-lg font-bold text-neutral-900">{profile.loginStreak}</p>
          <p className="text-xs text-neutral-500">🔥 Streak</p>
        </div>
      </div>

      {/* Track levels */}
      <div className="px-6 py-4">
        <h3 className="font-semibold text-neutral-900 text-sm mb-3">{t('profile.progressionTracks')}</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Social', level: profile.levelSocial },
            { label: 'Creator', level: profile.levelCreator },
            { label: 'Competitor', level: profile.levelCompetitor },
            { label: 'Generosity', level: profile.levelGenerosity },
            { label: 'Knowledge', level: profile.levelKnowledge },
            { label: 'Gaming', level: profile.levelGaming },
          ].map(({ label, level }) => (
            <div key={label} className="flex items-center justify-between bg-neutral-50 rounded-lg px-3 py-2">
              <span className="text-xs text-neutral-700">{label}</span>
              <span className="text-xs font-semibold text-primary-600">{t('profile.trackLevel', { level })}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/profile/$username')({
  component: ProfilePage,
});
