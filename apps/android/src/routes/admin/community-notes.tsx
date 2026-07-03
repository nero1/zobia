/**
 * apps/android/src/routes/admin/community-notes.tsx
 *
 * Community Notes review — mirrors apps/web/app/(admin)/admin/community-notes/page.tsx.
 * GET /api/admin/community-notes?status=, POST { noteId, action, adminComment? }.
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { AdminCardSkeleton, AdminEmptyState, AdminToast, AdminTabs, AdminBadge, timeAgo } from '@/components/admin/AdminUI';

type Status = 'pending' | 'approved' | 'rejected' | 'escalated';

interface CommunityNote {
  id: string;
  author_username: string | null;
  target_id: string;
  target_type: string;
  content: string;
  status: Status;
  reviewer_username: string | null;
  admin_comment: string | null;
  created_at: string;
  reviewed_at: string | null;
}

async function fetchNotes(status: Status): Promise<CommunityNote[]> {
  const { data } = await apiClient.get<{ notes: CommunityNote[] }>(`/admin/community-notes?status=${status}&limit=50`);
  return data?.notes ?? [];
}

const STATUS_COLOR: Record<Status, 'gold' | 'green' | 'red' | 'blue'> = { pending: 'gold', approved: 'green', rejected: 'red', escalated: 'blue' };

function AdminCommunityNotesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Status>('pending');
  const [toast, setToast] = useState<string | null>(null);

  const { data, status } = useQuery({ queryKey: ['admin', 'community-notes', tab], queryFn: () => fetchNotes(tab) });

  const review = useMutation({
    mutationFn: ({ noteId, action }: { noteId: string; action: 'approve' | 'reject' | 'escalate' }) =>
      apiClient.post('/admin/community-notes', { noteId, action }),
    onSuccess: () => {
      setToast(t('admin.moderation.actionApplied', 'Action applied'));
      setTimeout(() => setToast(null), 3000);
      qc.invalidateQueries({ queryKey: ['admin', 'community-notes'] });
    },
    onError: () => {
      setToast(t('admin.moderation.actionFailed', 'Action failed'));
      setTimeout(() => setToast(null), 3000);
    },
  });

  const tabs = [
    { key: 'pending' as const, label: t('admin.moderation.tab.pending', 'Pending') },
    { key: 'approved' as const, label: t('admin.communityNotes.approved', 'Approved') },
    { key: 'rejected' as const, label: t('admin.communityNotes.rejected', 'Rejected') },
    { key: 'escalated' as const, label: t('admin.moderation.tab.escalated', 'Escalated') },
  ];

  return (
    <div className="px-4 py-5">
      <h1 className="mb-4 text-xl font-bold text-neutral-900">{t('admin.nav.communityNotes', 'Community Notes')}</h1>
      {toast && <AdminToast message={toast} />}
      <AdminTabs tabs={tabs} active={tab} onChange={setTab} />

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'success' && (data?.length ?? 0) === 0 && <AdminEmptyState icon="📝" title={t('admin.communityNotes.empty', 'No notes here')} />}
        {status === 'success' &&
          data?.map((note) => (
            <div key={note.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs">
                <span className="font-semibold text-neutral-700">@{note.author_username ?? '—'}</span>
                <AdminBadge label={note.target_type} />
                <AdminBadge label={note.status} color={STATUS_COLOR[note.status]} />
                <span className="ml-auto text-neutral-400">{timeAgo(note.created_at)}</span>
              </div>
              <p className="mb-2.5 text-sm text-neutral-700">{note.content}</p>
              {note.reviewer_username && (
                <p className="mb-2 text-[11px] text-neutral-400">
                  {t('admin.communityNotes.reviewedBy', 'Reviewed by')} @{note.reviewer_username}
                </p>
              )}
              {note.status === 'pending' && (
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => review.mutate({ noteId: note.id, action: 'approve' })} className="rounded-lg bg-success-100 px-2.5 py-1 text-xs font-semibold text-success-700">
                    {t('admin.communityNotes.approve', 'Approve')}
                  </button>
                  <button onClick={() => review.mutate({ noteId: note.id, action: 'reject' })} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700">
                    {t('admin.communityNotes.reject', 'Reject')}
                  </button>
                  <button onClick={() => review.mutate({ noteId: note.id, action: 'escalate' })} className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                    {t('admin.communityNotes.escalate', 'Escalate')}
                  </button>
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/admin/community-notes')({
  component: AdminCommunityNotesPage,
});
