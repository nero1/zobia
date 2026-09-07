/**
 * apps/android/src/routes/messages/index.tsx
 *
 * Conversation list. GET /api/messages/dm.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { PullToRefresh } from '@/components/ui/PullToRefresh';

interface UserSuggestion {
  id: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
}

async function searchUsers(q: string): Promise<UserSuggestion[]> {
  const { data } = await apiClient.get<{ users?: UserSuggestion[]; data?: { users: UserSuggestion[] } }>(
    `/users/search?q=${encodeURIComponent(q)}&limit=10`
  );
  return data?.users ?? data?.data?.users ?? [];
}

/**
 * "New Message" recipient picker — mirrors apps/web NewMessageDialog.
 * Navigates in draft mode (no dm_conversations row exists yet); the chat
 * screen creates the real conversation on the first send.
 */
function NewMessageDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSuggestion[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchUsers(trimmed)
        .then((users) => { if (!cancelled) setResults(users); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  function handleOpenUser(userId: string) {
    onClose();
    navigate({ to: '/messages/$conversationId', params: { conversationId: userId }, search: { draft: '1' } });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-h-[80vh] flex flex-col rounded-t-2xl bg-white">
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-4">
          <h2 className="text-base font-bold text-neutral-900">{t('messages.dialog.title')}</h2>
          <button onClick={onClose} className="text-neutral-400" aria-label="Close">✕</button>
        </div>
        <div className="px-4 py-3">
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('messages.dialog.searchPlaceholder')}
            className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:outline-none"
            data-selectable
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {searching && (
            <div className="flex items-center justify-center py-6">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
            </div>
          )}
          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-neutral-400">
              {t('messages.dialog.noResults', { query: query.trim() })}
            </p>
          )}
          {results.map((u) => (
            <button
              key={u.id}
              onClick={() => handleOpenUser(u.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-neutral-50"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl">
                {u.avatarEmoji || '👤'}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neutral-900">{u.displayName}</p>
                <p className="text-xs text-neutral-400">@{u.username}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface Conversation {
  id: string;
  otherUser: {
    id: string;
    username: string;
    displayName: string;
    avatarEmoji: string;
  };
  lastMessage?: {
    content: string;
    createdAt: string;
  };
  unreadCount: number;
}

// Raw row shape returned by GET /api/messages/dm (snake_case, flat).
interface ConversationRow {
  conversation_id: string;
  other_user_id: string;
  other_username: string;
  other_display_name: string | null;
  other_avatar_emoji: string | null;
  last_message_content: string | null;
  last_message_at: string;
  unread_count: number;
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.conversation_id,
    otherUser: {
      id: row.other_user_id,
      username: row.other_username,
      displayName: row.other_display_name ?? row.other_username,
      avatarEmoji: row.other_avatar_emoji ?? '👤',
    },
    lastMessage: row.last_message_content
      ? { content: row.last_message_content, createdAt: row.last_message_at }
      : undefined,
    unreadCount: row.unread_count,
  };
}

async function fetchInbox() {
  // The API responds with { items, nextCursor, hasMore, total }, not a bare array —
  // treating the response itself as the list caused `conversations.map` to crash.
  const { data } = await apiClient.get<{ items: ConversationRow[] }>('/messages/dm');
  const rows = data?.items ?? [];
  return rows.map(mapConversation);
}

function MessagesPage() {
  const { t } = useTranslation();
  const [showNewMessage, setShowNewMessage] = useState(false);
  const { data: conversations, status, refetch } = useQuery({
    queryKey: ['inbox'],
    queryFn: fetchInbox,
    staleTime: 30_000,
  });

  return (
    <>
    <PullToRefresh onRefresh={() => refetch()} className="h-full overflow-y-auto bg-white">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
        <h1 className="text-lg font-bold text-neutral-900">{t('messages.title')}</h1>
        <button
          onClick={() => setShowNewMessage(true)}
          className="rounded-full bg-primary-600 px-4 py-2 text-xs font-semibold text-white"
        >
          {t('messages.newMessage')}
        </button>
      </div>
      {status === 'pending' && (
        <div className="divide-y divide-neutral-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-4 animate-pulse">
              <div className="w-12 h-12 rounded-full bg-neutral-200" />
              <div className="flex-1">
                <div className="h-4 bg-neutral-200 rounded w-32 mb-2" />
                <div className="h-3 bg-neutral-100 rounded w-48" />
              </div>
            </div>
          ))}
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
          <button onClick={() => refetch()} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm">
            {t('android.error.retry')}
          </button>
        </div>
      )}

      {status === 'success' && conversations?.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-neutral-500 text-sm">{t('messages.empty')}</p>
        </div>
      )}

      {conversations?.map((conv) => (
        <Link
          key={conv.id}
          to="/messages/$conversationId"
          params={{ conversationId: conv.id }}
          className="flex items-center gap-3 px-4 py-4 border-b border-neutral-100 active:bg-neutral-50"
        >
          <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center text-xl relative">
            {conv.otherUser.avatarEmoji || '👤'}
            {conv.unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary-600 text-white text-xs rounded-full flex items-center justify-center">
                {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-neutral-900 text-sm">{conv.otherUser.displayName}</p>
              {conv.lastMessage && (
                <p className="text-xs text-neutral-400">
                  {new Date(conv.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
            <p className="text-sm text-neutral-500 truncate">
              {conv.lastMessage?.content ?? t('messages.empty')}
            </p>
          </div>
        </Link>
      ))}
    </PullToRefresh>
    {showNewMessage && <NewMessageDialog onClose={() => setShowNewMessage(false)} />}
    </>
  );
}

export const Route = createFileRoute('/messages/')({
  component: MessagesPage,
});
