/**
 * apps/android/src/components/home/PresenceTabs.tsx
 *
 * Presence/liveness sub-section for the Home Dashboard logo tab — mirrors
 * apps/web/components/home/PresenceTabs.tsx. Relocated, unchanged-behavior
 * "Online Friends" logic (was `OnlineFriendsRow` inline in the previous
 * routes/home.tsx) plus a "Recently Active" tab, using the same GET
 * /api/friends/online response, which already computes both `isOnline`
 * (last_active_at within 5 min) and general recent-activity inclusion
 * (within 60 min) server-side.
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { OnlineRing } from '@/components/ui/OnlineRing';

interface Friend {
  userId: string;
  username: string;
  avatarEmoji: string;
  isOnline: boolean;
}

async function fetchOnlineFriends(): Promise<Friend[]> {
  // GET /api/friends/online replies with { success, data: friends[], friends }
  // (friends duplicated at both the top level and inside `data` for older
  // callers). apiClient's response interceptor already unwraps `data`, so
  // the value here IS the friends array already.
  const { data } = await apiClient.get<Friend[]>('/friends/online');
  return data ?? [];
}

function FriendsSkeleton() {
  return (
    <div className="flex gap-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex animate-pulse flex-col items-center gap-1">
          <div className="h-11 w-11 rounded-full bg-neutral-200" />
          <div className="h-2.5 w-10 rounded bg-neutral-200" />
        </div>
      ))}
    </div>
  );
}

function FriendGrid({ friends, emptyKey }: { friends: Friend[]; emptyKey: string }) {
  const { t } = useTranslation();
  if (friends.length === 0) {
    return <p className="text-xs text-neutral-400">{t(emptyKey)}</p>;
  }
  return (
    <div className="flex flex-wrap gap-4">
      {friends.map((f) => (
        <Link key={f.userId} to="/profile/$username" params={{ username: f.username }} className="flex flex-col items-center gap-1">
          <OnlineRing userId={f.userId} size="md" knownStatus={f.isOnline ? 'online' : 'recently_active'}>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-xl">{f.avatarEmoji || '🙂'}</div>
          </OnlineRing>
          <span className="max-w-[3rem] truncate text-xs text-neutral-500">@{f.username}</span>
        </Link>
      ))}
    </div>
  );
}

export function PresenceTabs() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'online' | 'recent'>('online');
  const { data: friends } = useQuery({ queryKey: ['home', 'friends', 'online'], queryFn: fetchOnlineFriends, staleTime: 60_000 });

  if (!friends) return <FriendsSkeleton />;

  const online = friends.filter((f) => f.isOnline);
  const recentlyActive = friends.filter((f) => !f.isOnline);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-1 rounded-lg bg-neutral-100 p-1">
        <button
          type="button"
          onClick={() => setTab('online')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${tab === 'online' ? 'bg-white shadow-sm' : 'text-neutral-500'}`}
        >
          {t('home.presence.online')}
        </button>
        <button
          type="button"
          onClick={() => setTab('recent')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${tab === 'recent' ? 'bg-white shadow-sm' : 'text-neutral-500'}`}
        >
          {t('home.presence.recentlyActive')}
        </button>
      </div>
      <p className="mb-3 text-[11px] text-neutral-400">{t('home.friends.privacyHint')}</p>
      {tab === 'online' ? (
        <FriendGrid friends={online} emptyKey="home.presence.emptyOnline" />
      ) : (
        <FriendGrid friends={recentlyActive} emptyKey="home.presence.emptyRecent" />
      )}
    </div>
  );
}
