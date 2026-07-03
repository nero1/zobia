/**
 * apps/android/src/routes/admin/messages.tsx
 *
 * Admin Messaging — mirrors apps/web/app/(admin)/admin/messages/page.tsx:
 * a broadcast-message composer (send to all users / by plan / by role / a
 * specific set of users) plus a history of sent messages with per-recipient
 * delivery status. This is the admin broadcast tool, not the user DM inbox.
 *
 * GET  /api/admin/messages              → { items, limit, offset } (no envelope)
 * GET  /api/admin/messages/:messageId    → { message, receipts, limit, offset } (no envelope)
 * POST /api/admin/messages               { subject, body, broadcastType, targetUserIds?,
 *                                           targetPlans?, targetRoles? } → { messageId, recipientCount }
 * GET  /api/admin/users?q=&limit=        → { users, hasMore, nextCursor } (used for the
 *                                           "specific users" recipient search)
 *
 * CONTRACT FIX vs the web reference: the web page's compose form posts
 * `{ recipientMode, plans, roles, userIds, subject, body }` and its detail
 * drawer expects a flat `{ body, deliveries: [...] }` shape — neither matches
 * this endpoint (`SendMessageSchema` wants `broadcastType` ∈
 * {direct,all,by_plan,by_role} + `targetUserIds`/`targetPlans`/`targetRoles`,
 * and GET :messageId actually returns `{ message, receipts }`), so sending a
 * message and opening a detail both fail on web. This page uses the real
 * contract, including mapping the "Specific Users" UI choice to the
 * `broadcastType: "direct"` the backend expects (not "specific").
 */

import { useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { AdminToast, AdminEmptyState, AdminErrorState, AdminBadge, AdminField, adminInputClass, fmtDate } from '@/components/admin/AdminUI';

type RecipientMode = 'all' | 'by_plan' | 'by_role' | 'direct';

interface SentMessage {
  id: string;
  sender_username: string | null;
  subject: string;
  broadcast_type: RecipientMode;
  recipient_count: number;
  delivered_count: number;
  read_count: number;
  created_at: string;
}

interface DeliveryReceipt {
  recipient_id: string;
  username: string | null;
  delivered_at: string | null;
  read_at: string | null;
}

interface MessageDetail {
  message: SentMessage & { body: string };
  receipts: DeliveryReceipt[];
}

interface UserSearchResult {
  id: string;
  username: string;
  avatarEmoji: string;
}

const PLAN_OPTIONS = ['free', 'plus', 'pro', 'max'];
const ROLE_OPTIONS = ['user', 'creator', 'moderator', 'guild_captain', 'verified_creator'];

const MODE_COLOR: Record<RecipientMode, 'blue' | 'teal' | 'gold' | 'neutral'> = {
  all: 'blue', by_plan: 'teal', by_role: 'gold', direct: 'neutral',
};

async function fetchMessages(): Promise<SentMessage[]> {
  const { data } = await apiClient.get<{ items: SentMessage[] }>('/admin/messages');
  return data?.items ?? [];
}

async function fetchMessageDetail(id: string): Promise<MessageDetail> {
  const { data } = await apiClient.get<MessageDetail>(`/admin/messages/${id}`);
  return data;
}

async function searchUsers(q: string): Promise<UserSearchResult[]> {
  const { data } = await apiClient.get<{ users: UserSearchResult[] }>(`/admin/users?q=${encodeURIComponent(q)}&limit=8`);
  return data?.users ?? [];
}

// ---------------------------------------------------------------------------
// User search input
// ---------------------------------------------------------------------------

function UserSearchInput({ selected, onAdd, onRemove }: { selected: UserSearchResult[]; onAdd: (u: UserSearchResult) => void; onRemove: (id: string) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  function handleChange(val: string) {
    setQ(val);
    clearTimeout(timer.current);
    if (!val.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const users = await searchUsers(val);
        setResults(users.filter((u) => !selected.some((s) => s.id === u.id)));
      } catch { /* ignore */ }
      setSearching(false);
    }, 300);
  }

  return (
    <div>
      <div className="relative">
        <input
          type="text"
          value={q}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={t('admin.messages.searchUsers', 'Search username…')}
          className={adminInputClass}
        />
        {searching && <span className="absolute right-3 top-2.5 h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />}
        {results.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-neutral-200 bg-white shadow-modal">
            {results.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => { onAdd(u); setQ(''); setResults([]); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-neutral-50"
              >
                <span>{u.avatarEmoji || '👤'}</span>
                <span className="font-medium text-neutral-900">@{u.username}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((u) => (
            <span key={u.id} className="flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800">
              {u.avatarEmoji} @{u.username}
              <button type="button" onClick={() => onRemove(u.id)} className="ml-1">✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail overlay
// ---------------------------------------------------------------------------

function MessageDetailOverlay({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, status } = useQuery({ queryKey: ['admin', 'messages', 'detail', id], queryFn: () => fetchMessageDetail(id) });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex-none flex items-center justify-between border-b border-neutral-200 px-4 py-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}>
        <h2 className="text-base font-semibold text-neutral-900">{t('admin.messages.detailTitle', 'Message Detail')}</h2>
        <button onClick={onClose} aria-label={t('nav.closeMenu')} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-4 p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        {status === 'pending' && <div className="h-24 animate-pulse rounded-xl bg-neutral-100" />}
        {status === 'error' && <p className="text-sm text-neutral-500">{t('error.generic')}</p>}
        {status === 'success' && data && (
          <>
            <div>
              <p className="text-xs text-neutral-500">{t('admin.messages.subject', 'Subject')}</p>
              <p className="font-semibold text-neutral-900">{data.message.subject}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-500">{t('admin.messages.body', 'Body')}</p>
              <p className="whitespace-pre-wrap text-sm text-neutral-700">{data.message.body}</p>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-lg border border-neutral-200 p-2.5">
                <p className="text-xs text-neutral-500">{t('admin.messages.recipients', 'Recipients')}</p>
                <p className="text-lg font-bold text-neutral-900">{data.message.recipient_count.toLocaleString()}</p>
              </div>
              <div className="rounded-lg border border-neutral-200 p-2.5">
                <p className="text-xs text-neutral-500">{t('admin.messages.delivered', 'Delivered')}</p>
                <p className="text-lg font-bold text-success-600">{data.receipts.filter((r) => r.delivered_at).length.toLocaleString()}</p>
              </div>
            </div>
            {data.receipts.length > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{t('admin.messages.deliveryStatus', 'Delivery Status')}</p>
                <div className="space-y-1.5">
                  {data.receipts.map((r) => (
                    <div key={r.recipient_id} className="flex items-center justify-between rounded-lg border border-neutral-100 px-3 py-2 text-xs">
                      <span className="font-medium text-neutral-900">@{r.username ?? 'unknown'}</span>
                      <span className="text-neutral-500">{r.delivered_at ? fmtDate(r.delivered_at) : '—'}</span>
                      <span className="text-neutral-500">{r.read_at ? fmtDate(r.read_at) : t('admin.messages.unread', 'Unread')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function AdminMessagesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [recipientMode, setRecipientMode] = useState<RecipientMode>('all');
  const [selectedPlans, setSelectedPlans] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [specificUsers, setSpecificUsers] = useState<UserSearchResult[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data: messages, status, refetch } = useQuery({ queryKey: ['admin', 'messages'], queryFn: fetchMessages });

  const toggleArr = (arr: string[], setArr: (v: string[]) => void, val: string) =>
    setArr(arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val]);

  const sendMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/admin/messages', {
        subject,
        body,
        broadcastType: recipientMode,
        ...(recipientMode === 'direct' ? { targetUserIds: specificUsers.map((u) => u.id) } : {}),
        ...(recipientMode === 'by_plan' ? { targetPlans: selectedPlans } : {}),
        ...(recipientMode === 'by_role' ? { targetRoles: selectedRoles } : {}),
      }),
    onSuccess: () => {
      showToast(t('admin.messages.sent', 'Message sent'));
      setSubject('');
      setBody('');
      setSpecificUsers([]);
      qc.invalidateQueries({ queryKey: ['admin', 'messages'] });
    },
    onError: () => showToast(t('admin.messages.sendFailed', 'Failed to send'), 'error'),
  });

  const canSend =
    !!subject && !!body && (recipientMode !== 'direct' || specificUsers.length > 0) && (recipientMode !== 'by_plan' || selectedPlans.length > 0) && (recipientMode !== 'by_role' || selectedRoles.length > 0);

  const MODE_LABEL: Record<RecipientMode, string> = {
    all: t('admin.messages.mode.all', 'All Users'),
    by_plan: t('admin.messages.mode.byPlan', 'By Plan'),
    by_role: t('admin.messages.mode.byRole', 'By Role'),
    direct: t('admin.messages.mode.specific', 'Specific Users'),
  };

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.nav.messages', 'Admin Messaging')}</h1>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <form
        onSubmit={(e) => { e.preventDefault(); if (canSend) sendMutation.mutate(); }}
        className="mb-6 space-y-3.5 rounded-xl border border-neutral-200 bg-white p-4 shadow-card"
      >
        <h2 className="text-sm font-semibold text-neutral-700">{t('admin.messages.compose', 'Compose Message')}</h2>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-neutral-700">{t('admin.messages.to', 'To')}</p>
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'by_plan', 'by_role', 'direct'] as RecipientMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setRecipientMode(m)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${recipientMode === m ? 'bg-primary-600 text-white' : 'bg-neutral-100 text-neutral-700'}`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        {recipientMode === 'by_plan' && (
          <div className="flex flex-wrap gap-2">
            {PLAN_OPTIONS.map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-xs capitalize">
                <input type="checkbox" checked={selectedPlans.includes(p)} onChange={() => toggleArr(selectedPlans, setSelectedPlans, p)} className="rounded border-neutral-300" />
                {p}
              </label>
            ))}
          </div>
        )}

        {recipientMode === 'by_role' && (
          <div className="flex flex-wrap gap-2">
            {ROLE_OPTIONS.map((r) => (
              <label key={r} className="flex items-center gap-1.5 text-xs capitalize">
                <input type="checkbox" checked={selectedRoles.includes(r)} onChange={() => toggleArr(selectedRoles, setSelectedRoles, r)} className="rounded border-neutral-300" />
                {r}
              </label>
            ))}
          </div>
        )}

        {recipientMode === 'direct' && (
          <UserSearchInput selected={specificUsers} onAdd={(u) => setSpecificUsers((prev) => [...prev, u])} onRemove={(id) => setSpecificUsers((prev) => prev.filter((u) => u.id !== id))} />
        )}

        <AdminField label={t('admin.messages.subject', 'Subject')}>
          <input required value={subject} onChange={(e) => setSubject(e.target.value)} className={adminInputClass} placeholder={t('admin.messages.subjectPlaceholder', 'Message subject')} />
        </AdminField>

        <AdminField label={t('admin.messages.body', 'Body')}>
          <textarea required rows={5} value={body} onChange={(e) => setBody(e.target.value)} className={`${adminInputClass} resize-y`} placeholder={t('admin.messages.bodyPlaceholder', 'Message body…')} />
        </AdminField>

        <button type="submit" disabled={!canSend || sendMutation.isPending} className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {sendMutation.isPending ? t('admin.messages.sending', 'Sending…') : t('admin.messages.send', 'Send Message')}
        </button>
      </form>

      <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{t('admin.messages.sentMessages', 'Sent Messages')}</h2>

      {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-neutral-100" />)}

        {status === 'success' && messages.length === 0 && <AdminEmptyState icon="💬" title={t('admin.messages.empty', 'No messages sent yet')} />}

        {status === 'success' &&
          messages.map((m) => (
            <button key={m.id} type="button" onClick={() => setDetailId(m.id)} className="w-full rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-card active:bg-neutral-50">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-semibold text-neutral-900">{m.subject}</p>
                <AdminBadge label={MODE_LABEL[m.broadcast_type] ?? m.broadcast_type} color={MODE_COLOR[m.broadcast_type] ?? 'neutral'} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-neutral-400">
                <span>{m.recipient_count.toLocaleString()} {t('admin.messages.recipients', 'recipients')}</span>
                <span>{m.delivered_count.toLocaleString()} {t('admin.messages.delivered', 'delivered')}</span>
                <span className="ml-auto">{fmtDate(m.created_at)}</span>
              </div>
            </button>
          ))}
      </div>

      {detailId && <MessageDetailOverlay id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

export const Route = createFileRoute('/admin/messages')({
  component: AdminMessagesPage,
});
