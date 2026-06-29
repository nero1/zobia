/**
 * apps/android/src/routes/messages/$conversationId.tsx
 *
 * DM chat screen with Ably subscription + adaptive poll.
 * Optimistic updates on send.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useState, useRef, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api/client';
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel';
import { useAdaptiveChatPoll } from '@/lib/hooks/useAdaptiveChatPoll';
import { useAuth } from '@/lib/auth/store';
import type { Message } from '@zobia/shared/types';

async function fetchMessages(conversationId: string) {
  const { data } = await apiClient.get<Message[]>(`/messages/dm/${conversationId}?limit=50`);
  return data ?? [];
}

function DmChatPage() {
  const { t } = useTranslation();
  const { conversationId } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');

  const queryKey = ['messages', 'dm', conversationId];

  const { data: messages } = useQuery({
    queryKey,
    queryFn: () => fetchMessages(conversationId),
    staleTime: 30_000,
  });

  const connected = useRealtimeChannel(
    `dm:conversation:${conversationId}`,
    useCallback((_, data) => {
      const msg = data as Message;
      qc.setQueryData<Message[]>(queryKey, (prev = []) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    }, [conversationId]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  const { pokePoll } = useAdaptiveChatPoll({
    poll: async () => {
      const fresh = await fetchMessages(conversationId);
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

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const { data } = await apiClient.post<Message>(`/messages/dm/${conversationId}`, { content });
      return data;
    },
    onMutate: async (content) => {
      const optimistic: Message = {
        id: `optimistic-${Date.now()}`,
        senderId: user?.id ?? '',
        content,
        messageType: 'text',
        isDeleted: false,
        coinCost: 0,
        replyCountFromRecipient: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages?.map((msg) => {
          const isMine = msg.senderId === user?.id;
          return (
            <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] px-4 py-2 rounded-2xl text-sm ${
                  isMine
                    ? 'bg-primary-600 text-white rounded-br-sm'
                    : 'bg-white text-neutral-900 shadow-card rounded-bl-sm'
                } ${msg.id.startsWith('optimistic-') ? 'opacity-70' : ''}`}
              >
                {msg.content}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="bg-white border-t border-neutral-200 px-4 py-3 flex items-center gap-3">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder={t('messages.typeHere')}
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

export const Route = createFileRoute('/messages/$conversationId')({
  component: DmChatPage,
});
