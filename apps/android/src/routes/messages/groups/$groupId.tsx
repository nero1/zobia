/**
 * apps/android/src/routes/messages/groups/$groupId.tsx
 *
 * Group chat conversation screen — mirrors
 * apps/web/app/(app)/messages/groups/[groupId]/page.tsx: message feed with
 * realtime + adaptive poll, live-presence heartbeat (soft concurrent cap,
 * same as Rooms), a members panel with admin moderation (mute/remove), and
 * a header menu for leave/block group.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useRealtimeChannel } from '@/lib/realtime/useRealtimeChannel';
import { useAdaptiveChatPoll } from '@/lib/hooks/useAdaptiveChatPoll';
import { useAuth } from '@/lib/auth/store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GroupInfo {
  id: string;
  name: string;
  avatar_emoji: string;
  tag: string | null;
  member_count: number;
  max_members: number;
  user_role: string;
}

interface GroupMessage {
  id: string;
  sender_id: string;
  username: string;
  display_name: string;
  avatar_emoji: string;
  message_type: string;
  content: string;
  created_at: string;
}

interface GroupMember {
  user_id: string;
  role: string;
  can_invite: boolean;
  muted_until: string | null;
  muted_reason: string | null;
  username: string;
  display_name: string | null;
  avatar_emoji: string | null;
}

const MUTE_DURATIONS: { minutes: number; labelKey: string }[] = [
  { minutes: 30, labelKey: 'messages.groupChat.mute.30m' },
  { minutes: 60, labelKey: 'messages.groupChat.mute.1h' },
  { minutes: 180, labelKey: 'messages.groupChat.mute.3h' },
  { minutes: 1440, labelKey: 'messages.groupChat.mute.1d' },
  { minutes: 4320, labelKey: 'messages.groupChat.mute.3d' },
  { minutes: 10080, labelKey: 'messages.groupChat.mute.7d' },
  { minutes: 43200, labelKey: 'messages.groupChat.mute.30d' },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------------------
// Members panel
// ---------------------------------------------------------------------------

function MembersPanel({
  groupId,
  currentUserId,
  isAdmin,
  onClose,
}: {
  groupId: string;
  currentUserId: string | undefined;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [muteTargetId, setMuteTargetId] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    try {
      const { data } = await apiClient.get<{ data?: GroupMember[] }>(`/messages/group/${groupId}/members`);
      setMembers(data.data ?? []);
    } catch {
      /* non-fatal */
    }
  }, [groupId]);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  async function handleRemove(userId: string) {
    setBusyUserId(userId);
    try {
      await apiClient.delete(`/messages/group/${groupId}/members`, { data: { userId } });
      await loadMembers();
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleMute(userId: string, durationMinutes: number | null) {
    setBusyUserId(userId);
    try {
      await apiClient.post(`/messages/group/${groupId}/members/${userId}/mute`, { durationMinutes });
      setMuteTargetId(null);
      await loadMembers();
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-h-[80vh] w-full overflow-hidden rounded-t-2xl bg-white">
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-4">
          <h2 className="text-base font-bold text-neutral-900">{t('messages.groupChat.members.title')}</h2>
          <button onClick={onClose} className="text-neutral-400" aria-label={t('action.close')}>✕</button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto">
          {members === null ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
            </div>
          ) : (
            members.map((m) => {
              const isMuted = !!m.muted_until && new Date(m.muted_until) > new Date();
              return (
                <div key={m.user_id} className="flex items-center gap-3 border-b border-neutral-100 px-4 py-3 last:border-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl">
                    {m.avatar_emoji ?? '👤'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-neutral-900">
                      {m.display_name || `@${m.username}`}
                      {m.role === 'admin' && (
                        <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                          {t('messages.groupChat.members.admin')}
                        </span>
                      )}
                      {isMuted && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          {t('messages.groupChat.members.muted')}
                        </span>
                      )}
                    </p>
                  </div>
                  {isAdmin && m.user_id !== currentUserId && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      {isMuted ? (
                        <button
                          onClick={() => void handleMute(m.user_id, null)}
                          disabled={busyUserId === m.user_id}
                          className="rounded-lg border border-neutral-300 px-2 py-1 text-[11px] font-semibold text-neutral-600 disabled:opacity-50"
                        >
                          {t('messages.groupChat.members.liftSuspension')}
                        </button>
                      ) : (
                        <div className="relative">
                          <button
                            onClick={() => setMuteTargetId(muteTargetId === m.user_id ? null : m.user_id)}
                            className="rounded-lg border border-neutral-300 px-2 py-1 text-[11px] font-semibold text-neutral-600"
                          >
                            {t('messages.groupChat.members.suspend')}
                          </button>
                          {muteTargetId === m.user_id && (
                            <div className="absolute right-0 top-full z-10 mt-1 w-36 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl">
                              {MUTE_DURATIONS.map((d) => (
                                <button
                                  key={d.minutes}
                                  onClick={() => void handleMute(m.user_id, d.minutes)}
                                  className="block w-full px-3 py-2 text-left text-xs text-neutral-700 active:bg-neutral-50"
                                >
                                  {t(d.labelKey)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        onClick={() => void handleRemove(m.user_id)}
                        disabled={busyUserId === m.user_id}
                        className="rounded-lg border border-red-300 px-2 py-1 text-[11px] font-semibold text-red-600 disabled:opacity-50"
                      >
                        {t('messages.groupChat.members.remove')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

async function fetchGroupInfo(groupId: string): Promise<GroupInfo | null> {
  const { data } = await apiClient.get<{ items?: GroupInfo[] }>('/messages/group');
  return (data.items ?? []).find((g) => g.id === groupId) ?? null;
}

async function fetchMessages(groupId: string, after?: string): Promise<GroupMessage[]> {
  const url = after
    ? `/messages/group/${groupId}?after=${encodeURIComponent(after)}`
    : `/messages/group/${groupId}`;
  const { data } = await apiClient.get<{ data?: GroupMessage[] }>(url);
  return data.data ?? [];
}

function GroupChatPage() {
  const { t } = useTranslation();
  const { groupId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [presenceFull, setPresenceFull] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const { data: group } = useQuery({
    queryKey: ['messages', 'group', groupId, 'info'],
    queryFn: () => fetchGroupInfo(groupId),
    staleTime: 30_000,
  });

  const queryKey = ['messages', 'group', groupId, 'messages'];

  const { data: messages } = useQuery({
    queryKey,
    queryFn: () => fetchMessages(groupId),
    staleTime: 30_000,
  });

  // Live-presence heartbeat — soft concurrent cap (mirrors Rooms). Admins
  // always pass server-side; a full response only disables the composer.
  useEffect(() => {
    let cancelled = false;
    async function heartbeat() {
      try {
        const { data } = await apiClient.post<{ full?: boolean }>(`/messages/group/${groupId}/presence`);
        if (!cancelled) setPresenceFull(!!data.full);
      } catch {
        /* non-fatal — fail open, matches server-side fail-open */
      }
    }
    void heartbeat();
    const interval = setInterval(() => void heartbeat(), 45_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [groupId]);

  const mergeIncoming = useCallback((incoming: GroupMessage[]) => {
    if (!incoming.length) return;
    qc.setQueryData<GroupMessage[]>(queryKey, (prev = []) => {
      const seen = new Set(prev.map((m) => m.id));
      const merged = prev.slice();
      for (const m of incoming) {
        if (m && m.id && !seen.has(m.id)) { merged.push(m); seen.add(m.id); }
      }
      merged.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const connected = useRealtimeChannel(
    `group:${groupId}:messages`,
    useCallback((event, data) => {
      if (event !== 'new_message') return;
      const msg = (data as { message?: GroupMessage })?.message;
      if (msg) mergeIncoming([msg]);
    }, [mergeIncoming])
  );

  const { pokePoll } = useAdaptiveChatPoll({
    poll: async () => {
      const latest = qc.getQueryData<GroupMessage[]>(queryKey) ?? [];
      const after = latest[latest.length - 1]?.created_at;
      const fresh = await fetchMessages(groupId, after);
      if (fresh.length > 0) {
        mergeIncoming(fresh);
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

  async function handleSend() {
    const content = text.trim();
    if (!content) return;
    setText('');
    setSendError(null);
    const optimisticId = `optimistic-${Date.now()}`;
    qc.setQueryData<GroupMessage[]>(queryKey, (prev = []) => [
      ...prev,
      {
        id: optimisticId,
        sender_id: user?.id ?? '',
        username: 'you',
        display_name: 'You',
        avatar_emoji: '💬',
        message_type: 'text',
        content,
        created_at: new Date().toISOString(),
      },
    ]);
    try {
      const { data } = await apiClient.post<{ data?: GroupMessage }>(`/messages/group/${groupId}`, {
        content,
        messageType: 'text',
      });
      const real = data.data;
      qc.setQueryData<GroupMessage[]>(queryKey, (prev = []) =>
        real ? prev.map((m) => (m.id === optimisticId ? real : m)) : prev.filter((m) => m.id !== optimisticId)
      );
      pokePoll();
    } catch (err) {
      qc.setQueryData<GroupMessage[]>(queryKey, (prev = []) => prev.filter((m) => m.id !== optimisticId));
      const fallback = t('messages.conversation.failedToSend');
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
      setSendError(axiosErr.response?.data?.error?.message ?? fallback);
      setTimeout(() => setSendError(null), 3000);
    }
  }

  async function handleLeaveGroup() {
    setShowMenu(false);
    if (!user?.id) return;
    try {
      await apiClient.delete(`/messages/group/${groupId}/members`, { data: { userId: user.id } });
      navigate({ to: '/messages/groups' });
    } catch {
      /* non-fatal — user can retry */
    }
  }

  async function handleBlockGroup() {
    setShowMenu(false);
    try {
      await apiClient.post(`/messages/group/${groupId}/block`);
      navigate({ to: '/messages/groups' });
    } catch {
      /* non-fatal — user can retry */
    }
  }

  const isAdmin = group?.user_role === 'admin';
  const composerDisabled = presenceFull && !isAdmin;

  return (
    <div className="h-full flex flex-col bg-neutral-50">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-neutral-100 bg-white px-4 py-3">
        <Link to="/messages/groups" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500" aria-label={t('messages.groupChat.backToGroups')}>
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        {group ? (
          <>
            <button
              onClick={() => setShowMembers(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-lg"
              aria-label={t('messages.groupChat.members.title')}
            >
              {group.avatar_emoji}
            </button>
            <button onClick={() => setShowMembers(true)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-bold text-neutral-900">{group.name}</p>
              <p className="text-[11px] text-neutral-400">
                {t('messages.groupChat.memberCount', { count: group.member_count })}
                {group.tag && <span className="ml-1.5">&middot; {group.tag}</span>}
              </p>
            </button>
            <div className="relative">
              <button
                onClick={() => setShowMenu((v) => !v)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500"
                aria-label={t('messages.groupChat.moreOptions')}
              >
                ⋮
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full z-10 mt-1 w-44 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl">
                  <button
                    onClick={() => { setShowMenu(false); setShowMembers(true); }}
                    className="block w-full px-4 py-2.5 text-left text-sm text-neutral-700 active:bg-neutral-50"
                  >
                    {t('messages.groupChat.members.title')}
                  </button>
                  <button
                    onClick={() => void handleLeaveGroup()}
                    className="block w-full px-4 py-2.5 text-left text-sm text-neutral-700 active:bg-neutral-50"
                  >
                    {t('messages.groupChat.leaveGroup')}
                  </button>
                  <button
                    onClick={() => void handleBlockGroup()}
                    className="block w-full px-4 py-2.5 text-left text-sm text-red-600 active:bg-red-50"
                  >
                    {t('messages.groupChat.blockGroup')}
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1">
            <div className="h-4 w-32 animate-pulse rounded bg-neutral-200" />
          </div>
        )}
      </div>

      {sendError && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2">
          <p className="text-xs text-red-700">{sendError}</p>
        </div>
      )}

      {presenceFull && !isAdmin && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2">
          <p className="text-xs text-amber-700">{t('messages.groupChat.full')}</p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages?.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-neutral-400">
            <span className="text-4xl">👥</span>
            <p className="mt-2 text-sm">{t('messages.groupChat.noMessagesYet')}</p>
          </div>
        )}
        {messages?.map((msg) => {
          const isMine = msg.sender_id === user?.id;
          return (
            <div key={msg.id} className={`flex gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
              <span className="mt-1 h-7 w-7 shrink-0 rounded-full bg-neutral-100 text-center text-sm leading-7">
                {msg.avatar_emoji}
              </span>
              <div className={`flex max-w-[75%] flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                {!isMine && (
                  <span className="mb-0.5 text-[11px] font-semibold text-primary-600">
                    {msg.display_name || `@${msg.username}`}
                  </span>
                )}
                <div
                  className={`px-3.5 py-2 rounded-2xl text-sm ${
                    isMine
                      ? 'bg-primary-600 text-white rounded-br-sm'
                      : 'bg-white text-neutral-900 shadow-card rounded-bl-sm'
                  } ${msg.id.startsWith('optimistic-') ? 'opacity-70' : ''}`}
                >
                  {msg.content}
                </div>
                <span className="mt-0.5 text-[10px] text-neutral-400">{timeAgo(msg.created_at)}</span>
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
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && void handleSend()}
          placeholder={t('messages.typeHere')}
          disabled={composerDisabled}
          className="flex-1 px-4 py-2 bg-neutral-100 rounded-full text-sm focus:outline-none disabled:opacity-50"
          data-selectable
        />
        <button
          onClick={() => void handleSend()}
          disabled={!text.trim() || composerDisabled}
          className="w-10 h-10 bg-primary-600 text-white rounded-full flex items-center justify-center disabled:opacity-40"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>

      {showMembers && group && (
        <MembersPanel
          groupId={groupId}
          currentUserId={user?.id}
          isAdmin={isAdmin}
          onClose={() => setShowMembers(false)}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/messages/groups/$groupId')({
  component: GroupChatPage,
});
