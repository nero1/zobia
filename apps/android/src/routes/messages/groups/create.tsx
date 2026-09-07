/**
 * apps/android/src/routes/messages/groups/create.tsx
 *
 * Create a new group chat — mirrors
 * apps/web/app/(app)/messages/groups/create/page.tsx.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { apiClient } from '@/lib/api/client';

interface Friend {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
}

interface FriendRow {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
}

const GROUP_TAGS = ['Personal', 'General', 'Crew', 'Study Group', 'Business', 'Other'] as const;
type GroupTag = (typeof GROUP_TAGS)[number] | '';

async function fetchFriends(): Promise<Friend[]> {
  const { data } = await apiClient.get<{ friends?: FriendRow[] }>('/friends');
  return (data.friends ?? []).map((f) => ({
    userId: f.userId ?? f.id,
    username: f.username,
    displayName: f.displayName ?? f.username,
    avatarEmoji: f.avatarEmoji ?? '👤',
  }));
}

function CreateGroupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [groupName, setGroupName] = useState('');
  const [tag, setTag] = useState<GroupTag>('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: friends, status } = useQuery({
    queryKey: ['friends', 'list'],
    queryFn: fetchFriends,
    staleTime: 60_000,
  });

  const filteredFriends = (friends ?? []).filter(
    (f) =>
      f.username.toLowerCase().includes(search.toLowerCase()) ||
      f.displayName.toLowerCase().includes(search.toLowerCase())
  );

  function toggleMember(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleCreate() {
    if (!groupName.trim()) { setError(t('messages.groupCreate.nameRequired')); return; }
    if (selected.size === 0) { setError(t('messages.groupCreate.memberRequired')); return; }

    setCreating(true);
    setError(null);
    try {
      const { data } = await apiClient.post<{ group: { id: string } }>('/messages/group', {
        name: groupName.trim(),
        tag: tag || undefined,
        memberIds: Array.from(selected),
      });
      navigate({ to: '/messages/groups/$groupId', params: { groupId: data.group.id } });
    } catch (err) {
      const fallback = t('messages.groupCreate.failed');
      const message = axios.isAxiosError(err)
        ? (err.response?.data as { error?: { message?: string } } | undefined)?.error?.message ?? fallback
        : fallback;
      setError(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-white px-4 py-4 space-y-5">
      <h1 className="text-lg font-bold text-neutral-900">{t('messages.groupCreate.title')}</h1>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-neutral-700">
          {t('messages.groupCreate.nameLabel')}
        </label>
        <input
          type="text"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder={t('messages.groupCreate.namePlaceholder')}
          maxLength={100}
          className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm focus:outline-none"
          data-selectable
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-neutral-700">
          {t('messages.groupCreate.typeLabel')}
        </label>
        <div className="flex flex-wrap gap-2">
          {GROUP_TAGS.map((tagOption) => (
            <button
              key={tagOption}
              type="button"
              onClick={() => setTag(tagOption === tag ? '' : tagOption)}
              className={`rounded-full px-3 py-1.5 text-xs transition-all ${
                tag === tagOption
                  ? 'bg-amber-400 font-semibold text-neutral-900'
                  : 'border border-neutral-200 text-neutral-600'
              }`}
            >
              {t(`messages.groupTypes.${tagOption.toLowerCase().replace(/\s+/g, '')}`, tagOption)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-neutral-700">
          {t('messages.groupCreate.addMembers')} {selected.size > 0 && <span className="text-amber-600">({selected.size} {t('messages.groupCreate.selected')})</span>}
        </label>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('messages.groupCreate.searchFriendsPlaceholder')}
          className="mb-2 w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm focus:outline-none"
          data-selectable
        />

        {status === 'pending' ? (
          <div className="py-8 text-center text-sm text-neutral-400">{t('messages.groupCreate.loadingFriends')}</div>
        ) : (friends ?? []).length === 0 ? (
          <div className="py-8 text-center text-sm text-neutral-400">{t('messages.groupCreate.noFriendsYet')}</div>
        ) : filteredFriends.length === 0 ? (
          <div className="py-4 text-center text-sm text-neutral-400">{t('messages.groupCreate.noFriendsMatch', { query: search })}</div>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-neutral-200 p-2">
            {filteredFriends.map((f) => (
              <button
                key={f.userId}
                type="button"
                onClick={() => toggleMember(f.userId)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all ${
                  selected.has(f.userId) ? 'bg-amber-50' : 'active:bg-neutral-50'
                }`}
              >
                <span className="text-xl">{f.avatarEmoji || '👤'}</span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold text-neutral-900">{f.displayName}</p>
                  <p className="truncate text-xs text-neutral-500">@{f.username}</p>
                </div>
                {selected.has(f.userId) && <span className="font-bold text-amber-500">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => void handleCreate()}
        disabled={creating || !groupName.trim() || selected.size === 0}
        className="w-full rounded-xl bg-amber-400 py-3.5 text-sm font-bold text-neutral-900 disabled:opacity-40"
      >
        {creating ? t('messages.groupCreate.creating') : t('messages.groupCreate.submit')}
      </button>
    </div>
  );
}

export const Route = createFileRoute('/messages/groups/create')({
  component: CreateGroupPage,
});
