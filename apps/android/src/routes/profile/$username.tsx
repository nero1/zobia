/**
 * apps/android/src/routes/profile/$username.tsx
 *
 * User profile view.
 *
 * There is no `GET /api/users/:username` endpoint on the backend — the only
 * public profile route is `GET /api/users/:userId/profile`, which takes a
 * UUID (it 400s on anything else) and replies with a bare `{ profile }` body
 * (not the `{ success, data, error }` envelope apiClient's interceptor
 * unwraps). So this page first resolves the username to a userId via
 * `GET /api/users/search`, then fetches the rich profile by id. The shared
 * `PublicProfile` type (ported from the old Expo app) doesn't match this
 * endpoint's actual field names/shape either, so a local type is used here.
 */

import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';

interface TrackLevel {
  track: string;
  label: string;
  emoji: string;
  level: number;
  maxLevel: number;
}

interface RichProfile {
  id: string;
  username: string;
  displayName: string | null;
  avatarEmoji: string | null;
  bio?: string | null;
  city: string | null;
  joinedAt: string;
  rankName: string | null;
  xp: number | null;
  plan: string;
  isVerified: boolean;
  trackLevels: TrackLevel[];
}

async function resolveUserId(username: string, selfId?: string, selfUsername?: string): Promise<string | null> {
  // Viewing your own profile: /api/users/search excludes the caller from its
  // results, so it can never resolve your own username — use the id we
  // already have instead of round-tripping to search.
  if (selfUsername && selfId && selfUsername.toLowerCase() === username.toLowerCase()) return selfId;

  const { data } = await apiClient.get<{ users: { id: string; username: string }[] }>(
    `/users/search?q=${encodeURIComponent(username)}`
  );
  const match = (data?.users ?? []).find((u) => u.username.toLowerCase() === username.toLowerCase());
  return match?.id ?? null;
}

async function fetchProfile(username: string, selfId?: string, selfUsername?: string) {
  const userId = await resolveUserId(username, selfId, selfUsername);
  if (!userId) return null;
  const { data } = await apiClient.get<{ profile: RichProfile }>(`/users/${userId}/profile`);
  return data?.profile ?? null;
}

function ProfilePage() {
  const { t } = useTranslation();
  const { username } = Route.useParams();
  const { user: currentUser } = useAuth();

  const { data: profile, status } = useQuery({
    queryKey: ['profile', username],
    queryFn: () => fetchProfile(username, currentUser?.id, currentUser?.username),
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

  const joinedYear = new Date(profile.joinedAt).getFullYear();

  return (
    <div className="h-full overflow-y-auto bg-white">
      {/* Hero */}
      <div className="px-6 pt-8 pb-6 border-b border-neutral-100">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-20 h-20 rounded-full bg-primary-100 flex items-center justify-center text-4xl">
            {profile.avatarEmoji || '👤'}
          </div>
          <div>
            <h2 className="text-xl font-bold text-neutral-900">{profile.displayName ?? profile.username}</h2>
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

      {/* Stats — the profile endpoint doesn't expose a login streak for
          non-owners, so this is XP + Rank only (was a 3-up grid with streak). */}
      <div className="grid grid-cols-2 divide-x divide-neutral-100 border-b border-neutral-100">
        <div className="px-4 py-4 text-center">
          <p className="text-lg font-bold text-neutral-900">{(profile.xp ?? 0).toLocaleString()}</p>
          <p className="text-xs text-neutral-500">XP</p>
        </div>
        <div className="px-4 py-4 text-center">
          <p className="text-lg font-bold text-neutral-900">{profile.rankName ?? '—'}</p>
          <p className="text-xs text-neutral-500">{t('profile.rank')}</p>
        </div>
      </div>

      {/* Track levels */}
      {profile.trackLevels.length > 0 && (
        <div className="px-6 py-4">
          <h3 className="font-semibold text-neutral-900 text-sm mb-3">{t('profile.progressionTracks')}</h3>
          <div className="grid grid-cols-2 gap-3">
            {profile.trackLevels.map((track) => (
              <div key={track.track} className="flex items-center justify-between bg-neutral-50 rounded-lg px-3 py-2">
                <span className="text-xs text-neutral-700">{track.label}</span>
                <span className="text-xs font-semibold text-primary-600">{t('profile.trackLevel', { level: track.level })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/profile/$username')({
  component: ProfilePage,
});
