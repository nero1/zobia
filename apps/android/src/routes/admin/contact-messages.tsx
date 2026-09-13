/**
 * apps/android/src/routes/admin/contact-messages.tsx
 *
 * Contact Messages inbox — mirrors apps/web/app/(admin)/gate44/contact-messages/page.tsx:
 * submissions from the site-wide Contact Us page.
 *
 * GET   /admin/contact-messages          -> { messages }
 * PATCH /admin/contact-messages/:id      -> marks read
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import {
  AdminCardSkeleton,
  AdminEmptyState,
  AdminErrorState,
  AdminToast,
  fmtDate,
} from '@/components/admin/AdminUI';

interface MessageRow {
  id: string;
  sender_name: string | null;
  sender_email: string | null;
  sender_username: string | null;
  subject: string | null;
  message: string;
  is_read: boolean;
  created_at: string;
}

async function fetchMessages(): Promise<MessageRow[]> {
  const { data } = await apiClient.get<{ messages: MessageRow[] }>('/admin/contact-messages');
  return data?.messages ?? [];
}

function AdminContactMessagesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);

  const { data: messages, status, refetch } = useQuery({ queryKey: ['admin', 'contact-messages'], queryFn: fetchMessages });

  const markRead = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/admin/contact-messages/${id}`),
    onMutate: (id) => {
      qc.setQueryData<MessageRow[]>(['admin', 'contact-messages'], (prev) =>
        prev?.map((m) => (m.id === id ? { ...m, is_read: true } : m))
      );
    },
    onSuccess: () => {
      setToast(t('admin.contactMessages.markedRead', 'Marked as read'));
      setTimeout(() => setToast(null), 2500);
    },
    onError: () => qc.invalidateQueries({ queryKey: ['admin', 'contact-messages'] }),
  });

  return (
    <div className="px-4 py-5">
      <h1 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">{t('admin.nav.contactMessages', 'Contact Messages')}</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">{t('admin.contactMessages.hint', 'Submissions from the site-wide Contact Us page.')}</p>

      {toast && <AdminToast message={toast} />}

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 4 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && (messages?.length ?? 0) === 0 && (
          <AdminEmptyState icon="✉️" title={t('admin.contactMessages.empty', 'No messages yet')} />
        )}
        {status === 'success' &&
          messages?.map((m) => (
            <div
              key={m.id}
              className={`rounded-xl border p-3.5 shadow-card ${m.is_read ? 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800' : 'border-primary-300 bg-primary-50 dark:bg-primary-900/30'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {m.sender_username ? `@${m.sender_username}` : m.sender_name || t('admin.contactMessages.anonymous', 'Anonymous')}
                </span>
                <span className="shrink-0 text-[10px] text-neutral-500 dark:text-neutral-400">{fmtDate(m.created_at)}</span>
              </div>
              {m.sender_email && <p className="text-xs text-neutral-500 dark:text-neutral-400">{m.sender_email}</p>}
              {m.subject && <p className="mt-1 text-sm font-semibold text-neutral-800 dark:text-neutral-200">{m.subject}</p>}
              <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{m.message}</p>
              {!m.is_read && (
                <button
                  type="button"
                  onClick={() => markRead.mutate(m.id)}
                  disabled={markRead.isPending}
                  className="mt-2.5 rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {t('admin.contactMessages.markRead', 'Mark as read')}
                </button>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/admin/contact-messages')({
  component: AdminContactMessagesPage,
});
