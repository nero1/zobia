/**
 * apps/android/src/routes/admin/ads-moderation-queue.tsx
 *
 * Ad Moderator review queue — mirrors
 * apps/web/app/(admin)/gate44/ads/moderation-queue/page.tsx: ad creative
 * images that neither DeepSeek (primary) nor Gemini (fallback/escalation)
 * could confidently classify (see lib/ai/vision.ts on web). Flat filename
 * (not nested under an `ads/` directory) because admin/ads.tsx is already a
 * single file route, matching this app's flat-file convention elsewhere
 * (leaderboard-banners.tsx, branded-rooms.tsx, etc).
 *
 * Reachable by accounts with only the narrower `is_ad_moderator` role, not
 * just full moderator/admin — see lib/api/middleware.ts
 * withAdModeratorOrAdminAuth on web (the same backend API this calls).
 *
 * GET  /api/admin/ads/moderation-queue?status=pending|approved|rejected
 * POST /api/admin/ads/moderation-queue/:id { action: 'approve'|'reject', note? }
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { AdminCard, AdminCardSkeleton, AdminEmptyState, AdminErrorState, AdminToast, AdminTabs, AdminConfirmDialog, timeAgo } from '@/components/admin/AdminUI';

type StatusTab = 'pending' | 'approved' | 'rejected';

interface VisionAttempt {
  provider: string;
  model: string;
  success: boolean;
  confidence: number | null;
  rawContent: string | null;
  errorMessage: string | null;
}

interface Escalation {
  id: string;
  campaign_id: string;
  campaign_name: string;
  advertiser_name: string | null;
  image_url: string;
  deepseek_result: VisionAttempt | null;
  gemini_result: VisionAttempt | null;
  status: StatusTab;
  reviewed_by_username: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

async function fetchQueue(status: StatusTab): Promise<Escalation[]> {
  const { data } = await apiClient.get<{ escalations: Escalation[] }>(`/admin/ads/moderation-queue?status=${status}`);
  return data.escalations;
}

function ProviderResult({ label, attempt }: { label: string; attempt: VisionAttempt | null }) {
  if (!attempt) {
    return <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-2 text-xs text-neutral-400">{label}: —</div>;
  }
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-2 text-xs">
      <p className="font-semibold text-neutral-700 dark:text-neutral-300">{label} ({attempt.model})</p>
      {attempt.success ? (
        <p className="text-neutral-500 dark:text-neutral-400">
          {attempt.confidence !== null ? `${Math.round(attempt.confidence * 100)}%` : 'n/a'}
          {attempt.rawContent ? ` — ${attempt.rawContent}` : ''}
        </p>
      ) : (
        <p className="text-danger-600 dark:text-danger-400">{attempt.errorMessage ?? 'failed'}</p>
      )}
    </div>
  );
}

function AdModerationQueuePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<StatusTab>('pending');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'ads-moderation-queue', tab], queryFn: () => fetchQueue(tab) });

  const resolveMutation = useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: 'approve' | 'reject'; note?: string }) =>
      apiClient.post(`/admin/ads/moderation-queue/${id}`, { action, note }),
    onSuccess: () => {
      showToast(t('admin.adModerationQueue.resolved', 'Escalation resolved.'));
      setConfirming(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['admin', 'ads-moderation-queue'] });
    },
    onError: () => showToast(t('admin.adModerationQueue.resolveError', 'Failed to resolve.'), 'error'),
  });

  return (
    <div className="px-4 py-5">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{t('admin.adModerationQueue', 'Ad Moderation Queue')}</h1>
      <p className="mb-4 mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        {t('admin.adModerationQueue.subtitle', "Ad images neither DeepSeek nor Gemini could confidently classify.")}
      </p>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <div className="mb-4">
        <AdminTabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'pending', label: t('admin.adModerationQueue.tab.pending', 'Pending') },
            { key: 'approved', label: t('admin.adModerationQueue.tab.approved', 'Approved') },
            { key: 'rejected', label: t('admin.adModerationQueue.tab.rejected', 'Rejected') },
          ]}
        />
      </div>

      {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
      {status === 'pending' && (
        <div className="space-y-3">{[0, 1].map((i) => <AdminCardSkeleton key={i} />)}</div>
      )}
      {status === 'success' && data.length === 0 && (
        <AdminEmptyState icon="🕵️" title={t('admin.adModerationQueue.empty', 'Nothing here')} />
      )}
      {status === 'success' && (
        <div className="space-y-3">
          {data.map((e) => (
            <AdminCard key={e.id}>
              <img src={e.image_url} alt="Ad creative" className="mb-2 h-40 w-full rounded-lg object-cover" />
              <p className="font-semibold text-neutral-900 dark:text-neutral-100">{e.campaign_name}</p>
              <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
                {e.advertiser_name ?? 'Unknown advertiser'} · {timeAgo(e.created_at)}
              </p>
              <div className="mb-2 grid grid-cols-1 gap-2">
                <ProviderResult label="DeepSeek" attempt={e.deepseek_result} />
                <ProviderResult label="Gemini" attempt={e.gemini_result} />
              </div>
              {e.status === 'pending' ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirming({ id: e.id, action: 'approve' })}
                    className="flex-1 rounded-lg bg-success-600 px-3 py-2 text-xs font-semibold text-white"
                  >
                    {t('admin.adModerationQueue.approve', 'Approve')}
                  </button>
                  <button
                    onClick={() => setConfirming({ id: e.id, action: 'reject' })}
                    className="flex-1 rounded-lg bg-danger-600 px-3 py-2 text-xs font-semibold text-white"
                  >
                    {t('admin.adModerationQueue.reject', 'Reject')}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  {e.status === 'approved' ? t('admin.adModerationQueue.approvedBy', 'Approved') : t('admin.adModerationQueue.rejectedBy', 'Rejected')}
                  {e.reviewed_by_username ? ` — ${e.reviewed_by_username}` : ''}
                </p>
              )}
            </AdminCard>
          ))}
        </div>
      )}

      {confirming && (
        <AdminConfirmDialog
          title={confirming.action === 'approve' ? t('admin.adModerationQueue.confirmApprove', 'Approve this ad?') : t('admin.adModerationQueue.confirmReject', 'Reject this ad?')}
          confirmLabel={t('admin.adModerationQueue.confirm', 'Confirm')}
          cancelLabel={t('common.cancel', 'Cancel')}
          danger={confirming.action === 'reject'}
          pending={resolveMutation.isPending}
          onConfirm={() => resolveMutation.mutate({ id: confirming.id, action: confirming.action, note: note || undefined })}
          onCancel={() => { setConfirming(null); setNote(''); }}
        >
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('admin.adModerationQueue.notePlaceholder', 'Note (optional)')}
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-sm"
            rows={2}
          />
        </AdminConfirmDialog>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/ads-moderation-queue')({
  component: AdModerationQueuePage,
});
