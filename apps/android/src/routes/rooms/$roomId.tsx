/**
 * apps/android/src/routes/rooms/$roomId.tsx
 *
 * Room chat screen. GET /api/rooms/:id/messages + Ably subscription.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useState, useRef, useEffect, useCallback } from 'react';
import { isAxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel';
import { useAdaptiveChatPoll } from '@/lib/hooks/useAdaptiveChatPoll';
import { useAuth } from '@/lib/auth/store';
import { useCurrency } from '@/lib/hooks/useCurrency';
import { useMomentsConfig } from '@/lib/hooks/useMomentsConfig';
import { LiveRoomPulseBar } from '@/components/ui/LiveRoomPulseBar';

interface Message {
  id: string;
  senderId: string;
  content: string;
  messageType?: string;
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
  message_type?: string;
}

function mapMessage(row: RoomMessageRow): Message {
  return {
    id: row.id,
    senderId: row.userId,
    content: row.content ?? '',
    messageType: row.message_type,
    sender: { username: row.username, avatarEmoji: row.avatarEmoji ?? '👤' },
  };
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
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
  const currency = useCurrency();
  const momentsConfig = useMomentsConfig();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [isMoment, setIsMoment] = useState(false);
  const [momentCurrency, setMomentCurrency] = useState<'credits' | 'stars'>('credits');
  const [momentError, setMomentError] = useState<string | null>(null);

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

  // Live-presence heartbeat — same soft-cap admission endpoint the web room
  // screen calls every ~45s (see app/api/rooms/[roomId]/presence/route.ts).
  // Powers the pulse bar's "active now" count and frees the slot automatically
  // via Redis TTL when the user leaves/backgrounds the app.
  useEffect(() => {
    let cancelled = false;
    const beat = () => { if (!cancelled) apiClient.post(`/rooms/${roomId}/presence`).catch(() => {}); };
    beat();
    const id = setInterval(beat, 45_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [roomId]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const body: Record<string, string> = { content };
      // BUG FIX (matches web): the request schema expects camelCase
      // `messageType`, not `message_type` — sending the wrong key gets
      // silently stripped by zod, so the message would post as plain text
      // and never appear on /moments.
      if (isMoment) {
        body.messageType = 'moment';
        body.currency = momentCurrency;
      }
      const { data } = await apiClient.post<{ message: RoomMessageRow }>(`/rooms/${roomId}/messages`, body);
      return mapMessage(data.message);
    },
    onMutate: async (content) => {
      const optimistic: Message = {
        id: `optimistic-${Date.now()}`,
        senderId: user?.id ?? '',
        content,
        messageType: isMoment ? 'moment' : 'text',
        sender: { username: user?.username ?? '', avatarEmoji: '👤' },
      };
      qc.setQueryData<Message[]>(queryKey, (prev = []) => [...prev, optimistic]);
      return { optimistic };
    },
    onSuccess: (msg, _, ctx) => {
      qc.setQueryData<Message[]>(queryKey, (prev = []) =>
        prev.map((m) => (m.id === ctx?.optimistic.id ? msg : m))
      );
      setIsMoment(false);
      pokePoll();
    },
    onError: (err, _, ctx) => {
      qc.setQueryData<Message[]>(queryKey, (prev = []) =>
        prev.filter((m) => m.id !== ctx?.optimistic.id)
      );
      if (isAxiosError<ApiErrorBody>(err)) {
        const code = err.response?.data?.error?.code;
        if (code === 'INSUFFICIENT_MOMENT_FUNDS' || code === 'MOMENTS_LEVEL_TOO_LOW') {
          setMomentError(err.response?.data?.error?.message ?? t('error.generic'));
          return;
        }
      }
    },
  });

  const handleSend = () => {
    const content = text.trim();
    if (!content) return;
    setMomentError(null);
    setText('');
    sendMutation.mutate(content);
  };

  return (
    <div className="h-full flex flex-col bg-neutral-50">
      {/* Live activity pulse bar — PRD §2.2, mirrors web room screen */}
      <div className="border-b border-neutral-200 bg-white px-4 py-2">
        <LiveRoomPulseBar roomId={roomId} />
      </div>

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
                    msg.messageType === 'moment'
                      ? 'border-2 border-purple-400 bg-purple-50 text-purple-900'
                      : isMine
                        ? 'bg-primary-600 text-white rounded-br-sm'
                        : 'bg-white text-neutral-900 shadow-card rounded-bl-sm'
                  } ${msg.id.startsWith('optimistic-') ? 'opacity-70' : ''}`}
                >
                  {msg.messageType === 'moment' && (
                    <p className="mb-0.5 text-[10px] font-semibold text-purple-600">⚡ {t('room.moment24h', { defaultValue: 'Moment · 24h' })}</p>
                  )}
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Moment mode indicator */}
      {isMoment && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-purple-200 bg-purple-50 px-4 py-1.5">
          <span className="text-sm">⚡</span>
          <span className="text-xs font-semibold text-purple-700">Moment · 24h</span>
          {!momentsConfig.isFree && (
            <span className="text-xs text-purple-600">
              · {momentCurrency === 'credits' ? momentsConfig.costCredits : momentsConfig.costStars}{' '}
              {momentCurrency === 'credits' ? currency.softPlural : currency.premiumPlural}
            </span>
          )}
          {momentsConfig.costCredits > 0 && momentsConfig.costStars > 0 && (
            <div className="ml-1 flex overflow-hidden rounded-lg border border-purple-300 text-xs">
              <button
                type="button"
                onClick={() => setMomentCurrency('credits')}
                className={`px-2 py-0.5 font-semibold ${momentCurrency === 'credits' ? 'bg-purple-600 text-white' : 'bg-white text-purple-700'}`}
              >
                {currency.softPlural}
              </button>
              <button
                type="button"
                onClick={() => setMomentCurrency('stars')}
                className={`px-2 py-0.5 font-semibold ${momentCurrency === 'stars' ? 'bg-purple-600 text-white' : 'bg-white text-purple-700'}`}
              >
                {currency.premiumPlural}
              </button>
            </div>
          )}
          <button type="button" onClick={() => setIsMoment(false)} className="ml-auto text-xs text-purple-500">Cancel</button>
        </div>
      )}

      {momentError && (
        <div className="flex items-center justify-between gap-3 border-t border-amber-200 bg-amber-50 px-4 py-2">
          <p className="text-xs text-amber-800">{momentError}</p>
          <div className="flex shrink-0 items-center gap-2">
            <Link to="/settings" onClick={() => setMomentError(null)} className="rounded-lg bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white">
              Buy {currency.softPlural}
            </Link>
            <button onClick={() => setMomentError(null)} className="text-xs text-amber-600">✕</button>
          </div>
        </div>
      )}

      <div className="bg-white border-t border-neutral-200 px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => { setIsMoment((v) => !v); setMomentError(null); }}
          title="Moment (24h)"
          aria-label="Toggle Moment mode"
          className={`w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center text-lg ${isMoment ? 'bg-purple-100 text-purple-700' : 'text-neutral-400'}`}
        >
          ⚡
        </button>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder={isMoment ? 'Send a moment (24h)…' : t('room.typeMessage')}
          className={`flex-1 px-4 py-2 rounded-full text-sm focus:outline-none ${isMoment ? 'bg-purple-50 border border-purple-300' : 'bg-neutral-100'}`}
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
