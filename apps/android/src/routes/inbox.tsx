/**
 * apps/android/src/routes/inbox.tsx
 *
 * Inbox — mirrors apps/web/app/(app)/inbox/page.tsx: system messages "From
 * Zobia" (GET /api/inbox), mark-as-read on tap (POST /api/inbox/:id/read,
 * optimistic), unread messages highlighted.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface InboxMessage {
  id: string;
  subject: string;
  body: string;
  senderName?: string;
  createdAt: string;
  readAt: string | null;
}

async function fetchInbox(): Promise<InboxMessage[]> {
  const { data } = await apiClient.get<
    { items?: Record<string, unknown>[]; messages?: Record<string, unknown>[] } | Record<string, unknown>[]
  >('/inbox');
  const rows: Record<string, unknown>[] = Array.isArray(data) ? data : (data?.items ?? data?.messages ?? []);
  return rows.map((m) => ({
    id: String(m.id ?? ''),
    subject: String(m.subject ?? ''),
    body: String(m.body ?? ''),
    senderName: String(m.sender_username ?? m.senderName ?? 'Zobia Team'),
    createdAt: String(m.created_at ?? m.createdAt ?? new Date().toISOString()),
    readAt: m.read_at != null ? String(m.read_at) : m.readAt != null ? String(m.readAt) : null,
  }));
}

async function markRead(id: string) {
  await apiClient.post(`/inbox/${id}/read`);
}

function MessageCard({ message, onRead }: { message: InboxMessage; onRead: (id: string) => void }) {
  const { t } = useTranslation();
  const unread = !message.readAt;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => { if (unread) onRead(message.id); }}
      className={`rounded-xl border bg-white p-4 mb-3 active:bg-neutral-50 ${unread ? 'border-blue-400' : 'border-neutral-200'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
            <h3 className={`text-sm font-semibold ${unread ? 'text-neutral-900' : 'text-neutral-600'}`}>
              {message.subject}
            </h3>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
              {t('inbox.fromZobia')}
            </span>
          </div>
          <p className="mt-1.5 line-clamp-2 text-sm text-neutral-600">{message.body}</p>
        </div>
        <span className="shrink-0 text-xs text-neutral-400">
          {new Date(message.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>
    </div>
  );
}

function InboxPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: messages, status, refetch } = useQuery({
    queryKey: ['inbox'],
    queryFn: fetchInbox,
    staleTime: 30_000,
  });

  const readMutation = useMutation({
    mutationFn: markRead,
    onMutate: async (id) => {
      qc.setQueryData<InboxMessage[]>(['inbox'], (prev = []) =>
        prev.map((m) => (m.id === id ? { ...m, readAt: new Date().toISOString() } : m))
      );
    },
  });

  if (status === 'pending') {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-6">
        <h1 className="text-xl font-bold text-neutral-900 mb-4">{t('inbox.title')}</h1>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-neutral-200 bg-white p-4 mb-3 animate-pulse">
            <div className="h-4 bg-neutral-200 rounded w-40 mb-2" />
            <div className="h-3 bg-neutral-100 rounded w-full mb-1" />
            <div className="h-3 bg-neutral-100 rounded w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
        <button onClick={() => refetch()} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm">
          {t('android.error.retry')}
        </button>
      </div>
    );
  }

  const unreadCount = (messages ?? []).filter((m) => !m.readAt).length;

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-6">
      <div className="flex items-center gap-3 mb-4">
        <h1 className="text-xl font-bold text-neutral-900">{t('inbox.title')}</h1>
        {unreadCount > 0 && (
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
            {t('inbox.unread', { count: unreadCount })}
          </span>
        )}
      </div>

      {(messages?.length ?? 0) === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <span className="text-5xl">📭</span>
          <h2 className="mt-4 text-lg font-semibold text-neutral-900">{t('inbox.noMessages')}</h2>
          <p className="mt-1 text-sm text-neutral-500">{t('inbox.noMessagesHint')}</p>
        </div>
      ) : (
        messages!.map((msg) => (
          <MessageCard key={msg.id} message={msg} onRead={(id) => readMutation.mutate(id)} />
        ))
      )}
    </div>
  );
}

export const Route = createFileRoute('/inbox')({
  component: InboxPage,
});
