/**
 * apps/android/src/routes/rooms/$roomId.tsx
 *
 * Room chat screen. GET /api/rooms/:id/messages + Ably subscription.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useState, useRef, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api/client';
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel';
import { useAdaptiveChatPoll } from '@/lib/hooks/useAdaptiveChatPoll';
import { useAuth } from '@/lib/auth/store';

interface Message {
  id: string;
  senderId: string;
  content: string;
  sender: { username: string; avatarEmoji: string };
}

// Raw row shape returned by GET /api/rooms/:id/messages and the realtime
// "new_message" event — already camelCase, but flat (userId, not sender.userId).
interface RoomMessageRow {
  id: string;
  userId: string;
  username: string;
  avatarEmoji: string;
  content: string | null;
}

function mapMessage(row: RoomMessageRow): Message {
  return {
    id: row.id,
    senderId: row.userId,
    content: row.content ?? '',
    sender: { username: row.username, avatarEmoji: row.avatarEmoji ?? '👤' },
  };
}

async function fetchRoomMessages(roomId: string) {
  // The API responds with { items, nextCursor, hasMore }, not a bare array —
  // treating the response itself as the list caused `messages.map` to crash.
  // Rows come back newest-first; reverse for chronological (oldest-first) display.
  const { data } = await apiClient.get<{ items: RoomMessageRow[] }>(`/rooms/${roomId}/messages?limit=50`);
  const rows = data?.items ?? [];
  return rows.map(mapMessage).reverse();
}

function RoomChatPage() {
  const { t } = useTranslation();
  const { roomId } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');

  const queryKey = ['rooms', roomId, 'messages'];

  const { data: messages } = useQuery({
    queryKey,
    queryFn: () => fetchRoomMessages(roomId),
    staleTime: 30_000,
  });

  const connected = useRealtimeChannel(
    `room:${roomId}:messages`,
    useCallback((event, data) => {
      if (event !== 'new_message') return;
      const msg = mapMessage(data as RoomMessageRow);
      qc.setQueryData<Message[]>(queryKey, (prev = []) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    }, [roomId]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  const { pokePoll } = useAdaptiveChatPoll({
    poll: async () => {
      const fresh = await fetchRoomMessages(roomId);
      const prev = qc.getQueryData<Message[]>(queryKey) ?? [];
      if (fresh.length !== prev.length) {
        qc.setQueryData(queryKey, fresh);
        return true;
      }
      return false;
    },
    connected,
    enabled: true,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const { data } = await apiClient.post<{ message: RoomMessageRow }>(`/rooms/${roomId}/messages`, { content });
      return mapMessage(data.message);
    },
    onMutate: async (content) => {
      const optimistic: Message = {
        id: `optimistic-${Date.now()}`,
        senderId: user?.id ?? '',
        content,
        sender: { username: user?.username ?? '', avatarEmoji: '👤' },
      };
      qc.setQueryData<Message[]>(queryKey, (prev = []) => [...prev, optimistic]);
      return { optimistic };
    },
    onSuccess: (msg, _, ctx) => {
      qc.setQueryData<Message[]>(queryKey, (prev = []) =>
        prev.map((m) => (m.id === ctx?.optimistic.id ? msg : m))
      );
      pokePoll();
    },
    onError: (_, __, ctx) => {
      qc.setQueryData<Message[]>(queryKey, (prev = []) =>
        prev.filter((m) => m.id !== ctx?.optimistic.id)
      );
    },
  });

  const handleSend = () => {
    const content = text.trim();
    if (!content) return;
    setText('');
    sendMutation.mutate(content);
  };

  return (
    <div className="h-full flex flex-col bg-neutral-50">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {messages?.map((msg) => {
          const isMine = msg.senderId === user?.id;
          return (
            <div key={msg.id} className={`flex items-end gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
              {!isMine && (
                <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-xs flex-shrink-0">
                  {msg.sender?.avatarEmoji ?? '👤'}
                </div>
              )}
              <div>
                {!isMine && msg.sender && (
                  <p className="text-xs text-neutral-400 mb-0.5 ml-1">@{msg.sender.username}</p>
                )}
                <div
                  className={`max-w-[75vw] px-4 py-2 rounded-2xl text-sm ${
                    isMine
                      ? 'bg-primary-600 text-white rounded-br-sm'
                      : 'bg-white text-neutral-900 shadow-card rounded-bl-sm'
                  } ${msg.id.startsWith('optimistic-') ? 'opacity-70' : ''}`}
                >
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="bg-white border-t border-neutral-200 px-4 py-3 flex items-center gap-3">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder={t('room.typeMessage')}
          className="flex-1 px-4 py-2 bg-neutral-100 rounded-full text-sm focus:outline-none"
          data-selectable
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sendMutation.isPending}
          className="w-10 h-10 bg-primary-600 text-white rounded-full flex items-center justify-center disabled:opacity-40"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/rooms/$roomId')({
  component: RoomChatPage,
});
