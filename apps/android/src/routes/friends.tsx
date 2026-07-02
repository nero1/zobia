/**
 * apps/android/src/routes/friends.tsx
 *
 * Friends management screen — mirrors apps/web/app/(app)/friends/page.tsx
 * with three tabs: My Friends, Requests (Received/Sent sub-tabs), and
 * Discover. The web page also has a "Recent chats" tab, but there is no
 * friends.tabs.recent (or friends.recent.*) i18n key yet, so it is omitted
 * here — see the report for the missing keys if that tab should be added.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface Friend {
  id: string;
  username: string;
  displayName: string | null;
  avatarEmoji: string;
}

interface FriendRequest {
  id: string;
  requesterId?: string;
  addresseeId?: string;
  username: string;
  displayName: string | null;
  avatarEmoji: string;
}

interface Suggestion {
  id: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  mutualFriendCount: number;
}

type Tab = 'friends' | 'requests' | 'discover';
type RequestsSubTab = 'received' | 'sent';

// ---------------------------------------------------------------------------
// Raw row shapes (snake_case) + mappers
// ---------------------------------------------------------------------------

interface FriendRow {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
}

function mapFriend(row: FriendRow): Friend {
  return { id: row.userId ?? row.id, username: row.username, displayName: row.displayName ?? null, avatarEmoji: row.avatarEmoji ?? '🙂' };
}

interface FriendRequestRow {
  id: string;
  requester_id?: string;
  addressee_id?: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string | null;
}

function mapRequest(row: FriendRequestRow): FriendRequest {
  return {
    id: row.id,
    requesterId: row.requester_id,
    addresseeId: row.addressee_id,
    username: row.username,
    displayName: row.display_name,
    avatarEmoji: row.avatar_emoji ?? '🙂',
  };
}

async function fetchFriends(): Promise<Friend[]> {
  const { data } = await apiClient.get<{ friends: FriendRow[] }>('/friends');
  return (data?.friends ?? []).map(mapFriend);
}

async function fetchReceivedRequests(): Promise<FriendRequest[]> {
  const { data } = await apiClient.get<{ data: FriendRequestRow[] }>('/friends/requests');
  return (data?.data ?? []).map(mapRequest);
}

async function fetchSentRequests(): Promise<FriendRequest[]> {
  const { data } = await apiClient.get<{ data: FriendRequestRow[] }>('/friends/requests/sent');
  return (data?.data ?? []).map(mapRequest);
}

async function fetchSuggestions(): Promise<Suggestion[]> {
  const { data } = await apiClient.get<{ suggestions: Suggestion[] }>('/friends/suggestions');
  return data?.suggestions ?? [];
}

// ---------------------------------------------------------------------------
// Shared profile row
// ---------------------------------------------------------------------------

function ProfileLink({
  username,
  name,
  emoji,
  children,
}: {
  username: string;
  name: string;
  emoji: string | null;
  children?: React.ReactNode;
}) {
  return (
    <Link to="/profile/$username" params={{ username }} className="flex min-w-0 flex-1 items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-lg shrink-0">{emoji || '🙂'}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-900">{name}</p>
        <p className="text-xs text-neutral-500">@{username}</p>
      </div>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// My Friends tab
// ---------------------------------------------------------------------------

function FriendsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: friends, status } = useQuery({ queryKey: ['friends', 'list'], queryFn: fetchFriends });

  const removeMutation = useMutation({
    mutationFn: (friendId: string) => apiClient.delete(`/friends/${friendId}`),
    onSuccess: (_res, friendId) => {
      qc.setQueryData<Friend[]>(['friends', 'list'], (prev = []) => prev.filter((f) => f.id !== friendId));
    },
  });

  if (status === 'pending') return <div className="py-8 text-center text-sm text-neutral-400">{t('common.loading', 'Loading…')}</div>;

  if (!friends || friends.length === 0) {
    return (
      <div className="py-12 text-center px-4">
        <p className="text-neutral-500">{t('friends.empty.noFriends')}</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-neutral-100">
      {friends.map((f) => (
        <li key={f.id} className="flex items-center gap-3 py-3 px-4">
          <ProfileLink username={f.username} name={f.displayName ?? f.username} emoji={f.avatarEmoji} />
          <button
            onClick={() => removeMutation.mutate(f.id)}
            disabled={removeMutation.isPending && removeMutation.variables === f.id}
            className="shrink-0 rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 disabled:opacity-50"
          >
            {t('friends.removeFriend')}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Requests tab (Received / Sent)
// ---------------------------------------------------------------------------

function ReceivedRequestsList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: requests, status } = useQuery({ queryKey: ['friends', 'requests', 'received'], queryFn: fetchReceivedRequests });

  const respondMutation = useMutation({
    mutationFn: ({ requestId, action }: { requestId: string; action: 'accept' | 'reject' }) =>
      apiClient.put(`/friends/${requestId}`, { action }),
    onSuccess: (_res, { requestId }) => {
      qc.setQueryData<FriendRequest[]>(['friends', 'requests', 'received'], (prev = []) => prev.filter((r) => r.id !== requestId));
      if (respondMutation.variables?.action === 'accept') qc.invalidateQueries({ queryKey: ['friends', 'list'] });
    },
  });

  if (status === 'pending') return <div className="py-8 text-center text-sm text-neutral-400">{t('common.loading', 'Loading…')}</div>;
  if (!requests || requests.length === 0) {
    return <div className="py-10 text-center px-4"><p className="text-neutral-500">{t('friends.empty.noReceivedRequests')}</p></div>;
  }

  return (
    <ul className="divide-y divide-neutral-100">
      {requests.map((r) => (
        <li key={r.id} className="flex items-center gap-3 py-3 px-4">
          <ProfileLink username={r.username} name={r.displayName ?? r.username} emoji={r.avatarEmoji} />
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => respondMutation.mutate({ requestId: r.id, action: 'accept' })}
              disabled={respondMutation.isPending && respondMutation.variables?.requestId === r.id}
              className="rounded-full bg-primary-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              {t('friends.accept')}
            </button>
            <button
              onClick={() => respondMutation.mutate({ requestId: r.id, action: 'reject' })}
              disabled={respondMutation.isPending && respondMutation.variables?.requestId === r.id}
              className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 disabled:opacity-50"
            >
              {t('friends.decline')}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function SentRequestsList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: requests, status } = useQuery({ queryKey: ['friends', 'requests', 'sent'], queryFn: fetchSentRequests });

  const withdrawMutation = useMutation({
    mutationFn: (requestId: string) => apiClient.delete(`/friends/${requestId}`),
    onSuccess: (_res, requestId) => {
      qc.setQueryData<FriendRequest[]>(['friends', 'requests', 'sent'], (prev = []) => prev.filter((r) => r.id !== requestId));
    },
  });

  if (status === 'pending') return <div className="py-8 text-center text-sm text-neutral-400">{t('common.loading', 'Loading…')}</div>;
  if (!requests || requests.length === 0) {
    return <div className="py-10 text-center px-4"><p className="text-neutral-500">{t('friends.empty.noSentRequests')}</p></div>;
  }

  return (
    <ul className="divide-y divide-neutral-100">
      {requests.map((r) => (
        <li key={r.id} className="flex items-center gap-3 py-3 px-4">
          <ProfileLink username={r.username} name={r.displayName ?? r.username} emoji={r.avatarEmoji} />
          <button
            onClick={() => withdrawMutation.mutate(r.id)}
            disabled={withdrawMutation.isPending && withdrawMutation.variables === r.id}
            className="shrink-0 rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 disabled:opacity-50"
          >
            {withdrawMutation.isPending && withdrawMutation.variables === r.id ? t('friends.requests.withdrawing') : t('friends.requests.withdraw')}
          </button>
        </li>
      ))}
    </ul>
  );
}

function RequestsTab() {
  const { t } = useTranslation();
  const [subTab, setSubTab] = useState<RequestsSubTab>('received');

  const subTabs: { id: RequestsSubTab; label: string }[] = [
    { id: 'received', label: t('friends.requests.received') },
    { id: 'sent', label: t('friends.requests.sent') },
  ];

  return (
    <div>
      <div className="flex gap-1 rounded-lg bg-neutral-100 p-1 mx-4 mt-3">
        {subTabs.map((st) => (
          <button
            key={st.id}
            onClick={() => setSubTab(st.id)}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${
              subTab === st.id ? 'bg-white text-neutral-900' : 'text-neutral-500'
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>
      {subTab === 'received' ? <ReceivedRequestsList /> : <SentRequestsList />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Discover tab
// ---------------------------------------------------------------------------

function DiscoverTab() {
  const { t } = useTranslation();
  const { data: suggestions, status } = useQuery({ queryKey: ['friends', 'suggestions'], queryFn: fetchSuggestions });
  const [sent, setSent] = useState<Set<string>>(new Set());

  const sendMutation = useMutation({
    mutationFn: (userId: string) => apiClient.post('/friends', { userId }),
    onSuccess: (_res, userId) => setSent((prev) => new Set(prev).add(userId)),
  });

  if (status === 'pending') return <div className="py-8 text-center text-sm text-neutral-400">{t('common.loading', 'Loading…')}</div>;
  if (!suggestions || suggestions.length === 0) {
    return <div className="py-12 text-center px-4"><p className="text-neutral-500">{t('friends.empty.noSuggestions')}</p></div>;
  }

  return (
    <ul className="divide-y divide-neutral-100">
      {suggestions.map((s) => (
        <li key={s.id} className="flex items-center gap-3 py-3 px-4">
          <ProfileLink username={s.username} name={s.displayName ?? s.username} emoji={s.avatarEmoji}>
            {s.mutualFriendCount > 0 && (
              <span className="ml-2 shrink-0 text-xs text-neutral-400">
                · {s.mutualFriendCount} {s.mutualFriendCount === 1 ? t('friends.mutualFriend') : t('friends.mutualFriends')}
              </span>
            )}
          </ProfileLink>
          <button
            onClick={() => sendMutation.mutate(s.id)}
            disabled={sent.has(s.id) || (sendMutation.isPending && sendMutation.variables === s.id)}
            className="shrink-0 rounded-full bg-primary-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
          >
            {sent.has(s.id) ? t('friends.sent') : t('friends.addFriend')}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function FriendsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('friends');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'friends', label: t('friends.tabs.myFriends') },
    { id: 'requests', label: t('friends.tabs.requests') },
    { id: 'discover', label: t('friends.tabs.discover') },
  ];

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-xl font-bold text-neutral-900">{t('friends.title')}</h1>
      </div>

      <div className="flex gap-1 rounded-xl border border-neutral-200 bg-white p-1 mx-4">
        {tabs.map((tItem) => (
          <button
            key={tItem.id}
            onClick={() => setTab(tItem.id)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium ${
              tab === tItem.id ? 'bg-primary-600 text-white' : 'text-neutral-500'
            }`}
          >
            {tItem.label}
          </button>
        ))}
      </div>

      <div className="mt-3 bg-white">
        {tab === 'friends' && <FriendsTab />}
        {tab === 'requests' && <RequestsTab />}
        {tab === 'discover' && <DiscoverTab />}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/friends')({
  component: FriendsPage,
});
