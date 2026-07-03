/**
 * apps/android/src/routes/admin/kyc.tsx
 *
 * Identity KYC review queue — mirrors apps/web/app/(admin)/admin/kyc/page.tsx's
 * "queue" tab (the Settings tab there is just a thin wrapper over
 * PUT /api/admin/config/[key], already covered by the Android Config admin page,
 * so it isn't duplicated here). List of pending/in-review submissions with a
 * detail overlay showing tier-specific fields, document images, and
 * approve/reject/schedule actions.
 *
 * Supports `?userId=` to deep-link into one user's submission history, e.g.
 * from the "View KYC Submissions" button in routes/admin/users.tsx.
 */

import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { apiClient } from '@/lib/api/client';
import {
  AdminCard,
  AdminCardSkeleton,
  AdminEmptyState,
  AdminErrorState,
  AdminToast,
  AdminBadge,
  adminInputClass,
  fmtDate,
} from '@/components/admin/AdminUI';

const kycSearchSchema = z.object({ userId: z.string().optional() });

type StatusFilter = 'all' | 'pending' | 'ai_review' | 'manual_review' | 'approved' | 'rejected';
const STATUS_FILTERS: StatusFilter[] = ['all', 'pending', 'ai_review', 'manual_review', 'approved', 'rejected'];

interface QueueItem {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  tier: number;
  status: string;
  account_type: string;
  citizenship_country: string | null;
  review_mode: string;
  ai_name_match_score: string | null;
  ai_document_confidence: string | null;
  ai_escalated: boolean;
  submitted_at: string;
}

interface DocumentItem {
  id: string;
  docType: string;
  createdAt: string;
  signedUrl: string | null;
}

interface SubmissionDetail extends QueueItem {
  email: string;
  bvn_last4: string | null;
  paystack_verification_status: string | null;
  id_type: string | null;
  id_number: string | null;
  submitted_full_name: string | null;
  ai_provider: string | null;
  ai_notes: string | null;
  video_url: string | null;
  liveness_status: string | null;
  liveness_score: string | null;
  liveness_notes: string | null;
  reuse_previous_address: boolean | null;
  updated_address: Record<string, string> | null;
  physical_verification_scheduled_at: string | null;
  physical_verification_notes: string | null;
  rejection_reason: string | null;
  documents: DocumentItem[];
}

const STATUS_COLOR: Record<string, 'gold' | 'blue' | 'green' | 'red' | 'neutral'> = {
  pending: 'gold',
  ai_review: 'blue',
  manual_review: 'gold',
  approved: 'green',
  rejected: 'red',
  cancelled: 'neutral',
};

async function fetchQueue(status: StatusFilter, userId: string | undefined, cursor: string | undefined) {
  const params = new URLSearchParams({ limit: '20' });
  if (status !== 'all') params.set('status', status);
  if (userId) params.set('userId', userId);
  if (cursor) params.set('cursor', cursor);
  const { data } = await apiClient.get<{ submissions: QueueItem[]; nextCursor: string | null; hasMore: boolean; queueDepth: { status: string; count: string }[] }>(
    `/admin/kyc?${params}`
  );
  return {
    submissions: data?.submissions ?? [],
    nextCursor: data?.nextCursor ?? null,
    hasMore: data?.hasMore ?? false,
    queueDepth: data?.queueDepth ?? [],
  };
}

async function fetchDetail(id: string): Promise<SubmissionDetail> {
  const { data } = await apiClient.get<SubmissionDetail>(`/admin/kyc/${id}`);
  return data;
}

// ---------------------------------------------------------------------------
// Detail overlay
// ---------------------------------------------------------------------------

function DetailOverlay({
  id,
  onClose,
  onResolved,
  onNotify,
}: {
  id: string;
  onClose: () => void;
  onResolved: () => void;
  onNotify: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleNotes, setScheduleNotes] = useState('');

  const { data: detail, status } = useQuery({ queryKey: ['admin', 'kyc', 'detail', id], queryFn: () => fetchDetail(id) });

  const approve = useMutation({
    mutationFn: () => apiClient.post(`/admin/kyc/${id}/approve`),
    onSuccess: onResolved,
  });
  const reject = useMutation({
    mutationFn: (reason: string) => apiClient.post(`/admin/kyc/${id}/reject`, { reason }),
    onSuccess: onResolved,
  });
  // ZSB-21 fix: this mutation had no onSuccess/onError at all — unlike
  // approve/reject right next to it — so after scheduling (or rescheduling)
  // a Tier-3 physical verification appointment, nothing on screen changed:
  // the detail view's own physical_verification_scheduled_at field wasn't
  // refetched, and there was no success/error toast, so the admin had no way
  // to tell whether the save actually worked.
  const schedule = useMutation({
    mutationFn: () =>
      apiClient.patch(`/admin/kyc/${id}/schedule`, {
        scheduledAt: scheduleDate ? new Date(scheduleDate).toISOString() : null,
        notes: scheduleNotes.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'kyc', 'detail', id] });
      onNotify(t('admin.kyc.scheduleSaved', 'Schedule saved'));
    },
    onError: () => onNotify(t('admin.kyc.scheduleFailed', 'Failed to save schedule')),
  });

  const canReview = detail && ['pending', 'ai_review', 'manual_review'].includes(detail.status);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex-none flex items-center justify-between border-b border-neutral-200 px-4 py-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}>
        <h2 className="text-base font-semibold text-neutral-900">{t('admin.kyc.detail.title', 'Submission Review')}</h2>
        <button onClick={onClose} aria-label={t('nav.closeMenu')} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
        {status === 'pending' && <AdminCardSkeleton />}

        {status === 'success' && detail && (
          <>
            <div>
              <p className="font-semibold text-neutral-900">{detail.display_name} (@{detail.username})</p>
              <p className="text-xs text-neutral-500">{detail.email}</p>
              <p className="mt-1 text-xs capitalize text-neutral-500">
                {detail.account_type} · {t('admin.kyc.tier', 'Tier')} {detail.tier} · {detail.review_mode} {t('admin.kyc.review', 'review')}
              </p>
              <div className="mt-1.5"><AdminBadge label={detail.status.replace(/_/g, ' ')} color={STATUS_COLOR[detail.status] ?? 'neutral'} /></div>
            </div>

            {detail.tier === 1 && (
              <div className="space-y-1 rounded-lg border border-neutral-200 p-3">
                <p className="text-sm font-medium text-neutral-800">{t('admin.kyc.tier1', 'Tier 1 — Identity')}</p>
                <p className="text-xs text-neutral-500">{t('admin.kyc.citizenship', 'Citizenship')}: {detail.citizenship_country ?? '—'}</p>
                {detail.bvn_last4 && (
                  <p className="text-xs text-neutral-500">
                    BVN: •••{detail.bvn_last4} ({detail.paystack_verification_status === 'failed' ? t('admin.kyc.paystackFailed', 'Paystack contact failed — review manually') : detail.paystack_verification_status ?? t('admin.kyc.notContacted', 'not yet contacted')})
                  </p>
                )}
                {detail.id_type && <p className="text-xs text-neutral-500">{t('admin.kyc.idType', 'ID type')}: {detail.id_type} — {detail.id_number ?? '—'}</p>}
                <p className="text-xs text-neutral-500">{t('admin.kyc.submittedName', 'Submitted name')}: {detail.submitted_full_name ?? '—'}</p>
                {detail.ai_name_match_score !== null && (
                  <p className="text-xs text-neutral-500">
                    {t('admin.kyc.ai', 'AI')}: {Math.round(Number(detail.ai_name_match_score) * 100)}% {t('admin.kyc.nameMatch', 'name match')}, {Math.round(Number(detail.ai_document_confidence ?? 0) * 100)}% {t('admin.kyc.docConfidence', 'document confidence')} ({detail.ai_provider ?? '—'})
                  </p>
                )}
                {detail.ai_notes && <p className="text-xs italic text-neutral-500">&quot;{detail.ai_notes}&quot;</p>}
              </div>
            )}

            {detail.tier === 2 && (
              <div className="space-y-1 rounded-lg border border-neutral-200 p-3">
                <p className="text-sm font-medium text-neutral-800">{t('admin.kyc.tier2', 'Tier 2 — Video + Liveness')}</p>
                {detail.video_url && (
                  <a href={detail.video_url} target="_blank" rel="noreferrer" className="block text-xs text-blue-600 underline">
                    {t('admin.kyc.watchVideo', 'Watch statement video →')}
                  </a>
                )}
                <p className="text-xs text-neutral-500">
                  {t('admin.kyc.livenessHeuristic', 'Liveness heuristic')}: {detail.liveness_status ?? t('admin.kyc.pending', 'pending')}{detail.liveness_score ? ` (${Math.round(Number(detail.liveness_score) * 100)}%)` : ''}
                </p>
                {detail.liveness_notes && <p className="text-xs italic text-neutral-500">&quot;{detail.liveness_notes}&quot;</p>}
              </div>
            )}

            {detail.tier === 3 && (
              <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
                <p className="text-sm font-medium text-neutral-800">{t('admin.kyc.tier3', 'Tier 3 — Physical KYC')}</p>
                <p className="text-xs text-neutral-500">
                  {detail.reuse_previous_address
                    ? t('admin.kyc.reuseAddress', 'Reusing previous address on file.')
                    : `${t('admin.kyc.updatedAddress', 'Updated address')}: ${JSON.stringify(detail.updated_address)}`}
                </p>
                <p className="text-xs text-amber-600">{t('admin.kyc.physicalHint', 'Schedule and complete the physical check out-of-band, then approve/reject here.')}</p>
                {detail.physical_verification_scheduled_at && (
                  <p className="text-xs text-neutral-600">{t('admin.kyc.scheduled', 'Scheduled')}: {new Date(detail.physical_verification_scheduled_at).toLocaleString()}</p>
                )}
                {canReview && (
                  <div className="space-y-1.5 rounded-lg bg-neutral-50 p-2">
                    <label className="block text-xs font-medium text-neutral-600">
                      {t('admin.kyc.scheduleDateTime', 'Physical check date/time')}
                      <input
                        type="datetime-local"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        className={`${adminInputClass} mt-1 text-xs`}
                      />
                    </label>
                    <label className="block text-xs font-medium text-neutral-600">
                      {t('admin.kyc.scheduleNotes', 'Notes')}
                      <textarea
                        value={scheduleNotes}
                        onChange={(e) => setScheduleNotes(e.target.value)}
                        placeholder={t('admin.kyc.scheduleNotesPlaceholder', 'e.g. location, contact person…')}
                        rows={2}
                        className={`${adminInputClass} mt-1 resize-none text-xs`}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={schedule.isPending}
                      onClick={() => schedule.mutate()}
                      className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {schedule.isPending ? '…' : t('admin.kyc.saveSchedule', 'Save schedule')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {detail.documents.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium text-neutral-800">{t('admin.kyc.documents', 'Documents')}</p>
                <div className="space-y-3">
                  {detail.documents.map((doc) => (
                    <div key={doc.id} className="overflow-hidden rounded-lg border border-neutral-200">
                      <p className="border-b border-neutral-100 bg-neutral-50 px-2.5 py-1.5 text-xs font-medium capitalize text-neutral-600">
                        {doc.docType.replace(/_/g, ' ')}
                      </p>
                      {doc.signedUrl ? (
                        <img src={doc.signedUrl} alt={doc.docType} className="rounded-b-lg w-full" />
                      ) : (
                        <p className="p-3 text-xs text-neutral-400">{t('admin.kyc.imageUnavailable', 'Image unavailable')}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.status === 'rejected' && detail.rejection_reason && (
              <p className="text-xs text-danger-600">{t('admin.kyc.rejected', 'Rejected')}: {detail.rejection_reason}</p>
            )}

            {canReview && (
              <div className="space-y-2 border-t border-neutral-200 pt-4">
                {!showReject ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={approve.isPending}
                      onClick={() => approve.mutate()}
                      className="flex-1 rounded-lg bg-success-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {approve.isPending ? '…' : t('admin.kyc.approve', '✓ Approve')}
                    </button>
                    <button
                      type="button"
                      disabled={approve.isPending}
                      onClick={() => setShowReject(true)}
                      className="flex-1 rounded-lg border border-danger-600 px-3 py-2.5 text-sm font-semibold text-danger-600 disabled:opacity-50"
                    >
                      {t('admin.kyc.reject', '✕ Reject')}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder={t('admin.kyc.rejectReasonPlaceholder', 'Reason shown to the user…')}
                      rows={3}
                      className={`${adminInputClass} resize-none text-sm`}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={reject.isPending || !rejectReason.trim()}
                        onClick={() => reject.mutate(rejectReason.trim())}
                        className="flex-1 rounded-lg bg-danger-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {reject.isPending ? '…' : t('admin.kyc.confirmReject', 'Confirm reject')}
                      </button>
                      <button type="button" onClick={() => setShowReject(false)} className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm">
                        {t('common.cancel', 'Cancel')}
                      </button>
                    </div>
                  </div>
                )}
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

function AdminKycPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { userId } = Route.useSearch();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const cursor = cursorHistory[pageIndex];
  const { data, status, refetch } = useQuery({
    queryKey: ['admin', 'kyc', 'queue', statusFilter, userId, cursor],
    queryFn: () => fetchQueue(statusFilter, userId, cursor),
  });

  const pendingCount = (data?.queueDepth ?? []).reduce((sum, q) => sum + Number(q.count), 0);

  const handleResolved = () => {
    setSelectedId(null);
    qc.invalidateQueries({ queryKey: ['admin', 'kyc', 'queue'] });
  };

  return (
    <div className="px-4 py-5">
      <h1 className="mb-1 text-xl font-bold text-neutral-900">{t('admin.nav.kyc', 'Identity KYC')}</h1>
      {pendingCount > 0 && <p className="mb-3 text-xs font-medium text-amber-600">{t('admin.kyc.awaitingReview', '{{count}} awaiting review', { count: pendingCount })}</p>}

      {toast && <AdminToast message={toast} />}

      {userId && (
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1.5 text-xs font-medium text-blue-700">
            {t('admin.kyc.filteredToUser', 'Filtered to one user')}
            <button type="button" onClick={() => navigate({ to: '/admin/kyc', search: {} })} aria-label={t('nav.closeMenu')} className="rounded-full p-0.5 hover:bg-blue-200">✕</button>
          </span>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setStatusFilter(s); setCursorHistory([undefined]); setPageIndex(0); }}
            className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusFilter === s ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'}`}
          >
            {t(`admin.kyc.status.${s}`, s.replace(/_/g, ' '))}
          </button>
        ))}
      </div>

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 5 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && data.submissions.length === 0 && <AdminEmptyState icon="🪪" title={t('admin.kyc.empty', 'No submissions found')} />}

        {status === 'success' &&
          data.submissions.map((item) => (
            <AdminCard key={item.id} onClick={() => setSelectedId(item.id)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-neutral-900">{item.display_name}</p>
                  <p className="truncate text-xs text-neutral-500">@{item.username}</p>
                </div>
                <AdminBadge label={item.status.replace(/_/g, ' ')} color={STATUS_COLOR[item.status] ?? 'neutral'} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                <span>{t('admin.kyc.tier', 'Tier')} {item.tier}</span>
                <span className="capitalize">· {item.account_type}</span>
                {item.ai_escalated && <span className="text-amber-600">⚠ {t('admin.kyc.escalated', 'escalated')}</span>}
                <span className="ml-auto">{fmtDate(item.submitted_at)}</span>
              </div>
              {item.ai_name_match_score !== null && (
                <p className="mt-1 text-[10px] text-neutral-400">
                  {Math.round(Number(item.ai_name_match_score) * 100)}% {t('admin.kyc.nameMatch', 'name match')} / {Math.round(Number(item.ai_document_confidence ?? 0) * 100)}% {t('admin.kyc.docConfidence', 'document confidence')}
                </p>
              )}
            </AdminCard>
          ))}
      </div>

      {status === 'success' && (data.submissions.length > 0 || pageIndex > 0) && (
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
            disabled={pageIndex === 0}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40"
          >
            {t('admin.pagination.prev', 'Prev')}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!data?.nextCursor) return;
              setCursorHistory((h) => [...h.slice(0, pageIndex + 1), data.nextCursor!]);
              setPageIndex((i) => i + 1);
            }}
            disabled={!data?.hasMore}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40"
          >
            {t('admin.pagination.next', 'Next')}
          </button>
        </div>
      )}

      {selectedId && (
        <DetailOverlay
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onResolved={() => { handleResolved(); notify(t('admin.moderation.actionApplied', 'Action applied')); }}
          onNotify={notify}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/kyc')({
  validateSearch: (search: Record<string, unknown>) => kycSearchSchema.parse(search),
  component: AdminKycPage,
});
