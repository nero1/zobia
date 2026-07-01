/**
 * apps/android/src/routes/messages/index.tsx
 *
 * Conversation list. GET /api/messages/dm.
 */

import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

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
  const { data: conversations, status, refetch } = useQuery({
    queryKey: ['inbox'],
    queryFn: fetchInbox,
    staleTime: 30_000,
  });

  return (
    <div className="h-full overflow-y-auto bg-white">
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
    </div>
  );
}

export const Route = createFileRoute('/messages/')({
  component: MessagesPage,
});
