/**
 * apps/android/src/routes/admin/automated-actions.tsx
 *
 * Auto Actions — mirrors apps/web/app/(admin)/admin/automated-actions/page.tsx.
 * GET /api/admin/automated-actions (cursor pagination),
 * POST /api/admin/automated-actions/:actionId/reverse { note? }.
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { AdminCardSkeleton, AdminEmptyState, AdminToast, AdminBadge, AdminConfirmDialog, adminInputClass, timeAgo } from '@/components/admin/AdminUI';

interface AutomatedAction {
  id: string;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  reversed_at: string | null;
  reverse_note: string | null;
  created_at: string;
}

async function fetchActions(cursor: string | undefined): Promise<{ items: AutomatedAction[]; next_cursor: string | null }> {
  const params = new URLSearchParams({ limit: '30' });
  if (cursor) params.set('cursor', cursor);
  const { data } = await apiClient.get<{ items: AutomatedAction[]; next_cursor?: string | null }>(`/admin/automated-actions?${params}`);
  return { items: data?.items ?? [], next_cursor: data?.next_cursor ?? null };
}

function AdminAutomatedActionsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [reversing, setReversing] = useState<AutomatedAction | null>(null);
  const [note, setNote] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const cursor = cursorHistory[pageIndex];
  const { data, status } = useQuery({ queryKey: ['admin', 'automated-actions', cursor], queryFn: () => fetchActions(cursor) });

  const reverse = useMutation({
    mutationFn: ({ actionId, note }: { actionId: string; note: string }) =>
      apiClient.post(`/admin/automated-actions/${actionId}/reverse`, note ? { note } : {}),
    onSuccess: () => {
      setToast(t('admin.actionsLog.reversed', 'Action reversed'));
      setTimeout(() => setToast(null), 3000);
      setReversing(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['admin', 'automated-actions'] });
    },
    onError: () => {
      setToast(t('admin.moderation.actionFailed', 'Action failed'));
      setTimeout(() => setToast(null), 3000);
    },
  });

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.nav.automatedActions', 'Auto Actions')}</h1>
      {toast && <AdminToast message={toast} />}

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 5 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'success' && (data?.items.length ?? 0) === 0 && <AdminEmptyState icon="🤖" title={t('admin.actionsLog.empty', 'No actions logged yet')} />}
        {status === 'success' &&
          data?.items.map((item) => (
            <div key={item.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs">
                <AdminBadge label={item.action_type.replace(/_/g, ' ')} color="blue" />
                {item.target_type && <AdminBadge label={item.target_type} />}
                {item.reversed_at && <AdminBadge label={t('admin.actionsLog.reversed', 'Reversed')} color="gold" />}
                <span className="ml-auto text-neutral-400">{timeAgo(item.created_at)}</span>
              </div>
              {item.target_id && <p className="mb-2 truncate text-xs text-neutral-500">{t('admin.actionsLog.target', 'Target')}: {item.target_id}</p>}
              {!item.reversed_at && (
                <button onClick={() => setReversing(item)} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700">
                  {t('admin.actionsLog.reverse', 'Reverse')}
                </button>
              )}
              {item.reversed_at && item.reverse_note && (
                <p className="text-[11px] text-neutral-400">{t('admin.actionsLog.note', 'Note')}: {item.reverse_note}</p>
              )}
            </div>
          ))}
      </div>

      {status === 'success' && (
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
            disabled={pageIndex === 0}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40"
          >
            {t('admin.pagination.prev', 'Prev')}
          </button>
          <button
            onClick={() => {
              if (!data?.next_cursor) return;
              setCursorHistory((h) => [...h.slice(0, pageIndex + 1), data.next_cursor!]);
              setPageIndex((i) => i + 1);
            }}
            disabled={!data?.next_cursor}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40"
          >
            {t('admin.pagination.next', 'Next')}
          </button>
        </div>
      )}

      {reversing && (
        <AdminConfirmDialog
          title={t('admin.actionsLog.reverseTitle', 'Reverse this action?')}
          confirmLabel={t('admin.actionsLog.reverse', 'Reverse')}
          cancelLabel={t('common.cancel')}
          pending={reverse.isPending}
          onCancel={() => { setReversing(null); setNote(''); }}
          onConfirm={() => reverse.mutate({ actionId: reversing.id, note: note.trim() })}
        >
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('admin.actionsLog.notePlaceholderOptional', 'Reversal note (optional)…')}
            rows={2}
            className={`${adminInputClass} resize-none text-sm`}
          />
        </AdminConfirmDialog>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/automated-actions')({
  component: AdminAutomatedActionsPage,
});
