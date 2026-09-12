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

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';
import { UserBadgeRow } from '@/components/shared/UserBadges';
import { PhotoGallery } from '@/components/profile/PhotoGallery';
import { ProfileMoments, useProfileMomentsQuery } from '@/components/profile/ProfileMoments';
import { ActivityFeed, useProfileActivityQuery } from '@/components/profile/ActivityFeed';
import type { RankName } from '@zobia/shared/types';

// Product decision: this codebase has no "Tweets"/status-post feature (no
// ProfileTweets component, no /api/tweets route). Moments is the closest
// existing analog — short public posts with optional media — and is reused
// here as the "Moments" tab, mirroring apps/web's substitution.
type ProfileTab = 'moments' | 'activities';

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
  loginStreak?: number | null;
  longestStreak?: number | null;
  plan: string;
  isVerified: boolean;
  prestige?: number;
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
  const { tab: tabParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { user: currentUser } = useAuth();

  const { data: profile, status } = useQuery({
    queryKey: ['profile', username],
    queryFn: () => fetchProfile(username, currentUser?.id, currentUser?.username),
    staleTime: 5 * 60_000,
  });

  const userId = profile?.id ?? '';
  const { data: moments, isLoading: momentsLoading } = useProfileMomentsQuery(userId);
  const { data: activities, isLoading: activitiesLoading, forbidden: activitiesHidden } = useProfileActivityQuery(userId);
  const hasMoments = !momentsLoading && !!moments && moments.length > 0;
  const showMomentsTab = momentsLoading || hasMoments;
  const showActivitiesTab = !activitiesHidden;

  const [activeTab, setActiveTab] = useState<ProfileTab>(tabParam === 'activities' ? 'activities' : 'moments');

  useEffect(() => {
    if (tabParam === 'activities' || tabParam === 'moments') return; // explicit deep link wins
    if (momentsLoading) return;
    if (!hasMoments && showActivitiesTab) setActiveTab('activities');
  }, [momentsLoading, hasMoments, showActivitiesTab, tabParam]);

  useEffect(() => {
    if (activeTab === 'activities' && !showActivitiesTab && showMomentsTab) setActiveTab('moments');
    else if (activeTab === 'moments' && !showMomentsTab && showActivitiesTab) setActiveTab('activities');
  }, [activeTab, showActivitiesTab, showMomentsTab]);

  function selectTab(tab: ProfileTab) {
    setActiveTab(tab);
    void navigate({ search: (prev) => ({ ...prev, tab }) });
  }

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
            <h2 className="inline-flex items-center gap-1.5 text-xl font-bold text-neutral-900">
              {profile.displayName ?? profile.username}
              <UserBadgeRow rank={profile.rankName as RankName} prestige={profile.prestige} verified={profile.isVerified} size="md" />
            </h2>
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

      {/* Stats — GET /api/users/:userId/profile now includes loginStreak. */}
      <div className={`grid ${profile.loginStreak ? 'grid-cols-3' : 'grid-cols-2'} divide-x divide-neutral-100 border-b border-neutral-100`}>
        <div className="px-4 py-4 text-center">
          <p className="text-lg font-bold text-neutral-900">{(profile.xp ?? 0).toLocaleString()}</p>
          <p className="text-xs text-neutral-500">XP</p>
        </div>
        <div className="px-4 py-4 text-center">
          <p className="text-lg font-bold text-neutral-900">{profile.rankName ?? '—'}</p>
          <p className="text-xs text-neutral-500">{t('profile.rank')}</p>
        </div>
        {!!profile.loginStreak && (
          <div className="px-4 py-4 text-center" title={profile.longestStreak ? `Longest: ${profile.longestStreak}` : undefined}>
            <p className="text-lg font-bold text-orange-600">🔥 {profile.loginStreak}</p>
            <p className="text-xs text-neutral-500">{t('profile.streak', 'Day Streak')}</p>
          </div>
        )}
      </div>

      {/* Track levels */}
      {profile.trackLevels.length > 0 && (
        <div className="px-6 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-neutral-900 text-sm">{t('profile.progressionTracks')}</h3>
            <Link to="/leaderboards" className="text-xs font-semibold text-primary-600">
              🏆 {t('profile.leaderboard.view', 'View Leaderboard')} →
            </Link>
          </div>
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

      {/* Photo gallery — sourced from Moments */}
      <div className="px-6 py-4 border-t border-neutral-100">
        <h3 className="font-semibold text-neutral-900 text-sm mb-3">📷 {t('profile.gallery.title', 'Photo Gallery')}</h3>
        <PhotoGallery userId={userId} />
      </div>

      {/* Moments | Activities tabs */}
      {(showMomentsTab || showActivitiesTab) && (
        <div className="px-6 py-4 border-t border-neutral-100">
          <div className="mb-3 flex gap-4 border-b border-neutral-100">
            {showMomentsTab && (
              <button
                type="button"
                onClick={() => selectTab('moments')}
                className={`-mb-px border-b-2 px-1 pb-2 text-sm font-semibold ${
                  activeTab === 'moments' ? 'border-primary-600 text-primary-600' : 'border-transparent text-neutral-500'
                }`}
              >
                {t('profile.tabs.moments', 'Moments')}
              </button>
            )}
            {showActivitiesTab && (
              <button
                type="button"
                onClick={() => selectTab('activities')}
                className={`-mb-px border-b-2 px-1 pb-2 text-sm font-semibold ${
                  activeTab === 'activities' ? 'border-primary-600 text-primary-600' : 'border-transparent text-neutral-500'
                }`}
              >
                {t('profile.tabs.activities', 'Activities')}
              </button>
            )}
          </div>
          {activeTab === 'moments' && showMomentsTab && <ProfileMoments moments={moments} loading={momentsLoading} />}
          {activeTab === 'activities' && showActivitiesTab && <ActivityFeed activities={activities} loading={activitiesLoading} />}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/profile/$username')({
  validateSearch: (search: Record<string, unknown>): { tab?: ProfileTab } => ({
    tab: search.tab === 'activities' || search.tab === 'moments' ? search.tab : undefined,
  }),
  component: ProfilePage,
});
