/**
 * apps/android/src/routes/admin/sponsored-quests.tsx
 *
 * Sponsored Quest Marketplace — mirrors apps/web/app/(admin)/admin/sponsored-quests/page.tsx (PRD §14).
 * GET /admin/sponsored-quests?active=false -> {success,data:{quests}} (auto-unwrapped).
 * POST /admin/sponsored-quests (publish), PATCH /admin/sponsored-quests/:id (edit/toggle),
 * DELETE /admin/sponsored-quests/:id (soft-delete), POST /admin/sponsored-quests/:id/moderate
 * { action: 'approve'|'reject', reason? } (business-submitted quests only).
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import {
  AdminCard,
  AdminCardSkeleton,
  AdminEmptyState,
  AdminErrorState,
  AdminToast,
  AdminBadge,
  AdminConfirmDialog,
  AdminField,
  adminInputClass,
  fmtNumber,
  fmtDate,
} from '@/components/admin/AdminUI';

type CreatorTier = 'verified' | 'elite' | 'icon';

interface SponsoredQuest {
  id: string;
  brand_name: string;
  title: string;
  description: string;
  requirements: string;
  reward_coins: number;
  creator_share_percent: number;
  platform_share_percent: number;
  max_applications: number;
  deadline: string;
  min_creator_tier: string;
  is_active: boolean;
  created_at: string;
  application_count: number;
  approved_count: number;
  moderation_status: 'pending' | 'approved' | 'rejected';
  moderation_reason: string | null;
  business_account_id: string | null;
  submitted_by_username: string | null;
}

interface QuestForm {
  brandName: string;
  brandLogoUrl: string;
  title: string;
  description: string;
  requirements: string;
  rewardCoins: string;
  creatorSharePercent: string;
  maxApplications: string;
  deadline: string;
  minCreatorTier: CreatorTier;
}

const EMPTY_FORM: QuestForm = {
  brandName: '',
  brandLogoUrl: '',
  title: '',
  description: '',
  requirements: '',
  rewardCoins: '5000',
  creatorSharePercent: '70',
  maxApplications: '10',
  deadline: '',
  minCreatorTier: 'verified',
};

const MOD_BADGE: Record<string, 'gold' | 'red' | 'blue'> = { pending: 'gold', rejected: 'red', approved: 'blue' };

async function fetchQuests(): Promise<SponsoredQuest[]> {
  const { data } = await apiClient.get<{ quests: SponsoredQuest[] }>('/admin/sponsored-quests?active=false');
  return data?.quests ?? [];
}

function questFormToBody(form: QuestForm) {
  const creatorShare = Number(form.creatorSharePercent);
  return {
    brandName: form.brandName,
    brandLogoUrl: form.brandLogoUrl || null,
    title: form.title,
    description: form.description,
    requirements: form.requirements,
    rewardCoins: Number(form.rewardCoins),
    creatorSharePercent: creatorShare,
    platformSharePercent: 100 - creatorShare,
    maxApplications: Number(form.maxApplications),
    deadline: new Date(form.deadline).toISOString(),
    minCreatorTier: form.minCreatorTier,
  };
}

function QuestFormFields({ form, setForm }: { form: QuestForm; setForm: (updater: (f: QuestForm) => QuestForm) => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <AdminField label={t('admin.sponsoredQuests.brandName', 'Brand Name')}>
        <input value={form.brandName} onChange={(e) => setForm((f) => ({ ...f, brandName: e.target.value }))} className={adminInputClass} placeholder="e.g. MTN Nigeria" />
      </AdminField>
      <AdminField label={t('admin.sponsoredQuests.brandLogoUrl', 'Brand Logo URL')}>
        <input value={form.brandLogoUrl} onChange={(e) => setForm((f) => ({ ...f, brandLogoUrl: e.target.value }))} className={adminInputClass} placeholder="https://…" />
      </AdminField>
      <AdminField label={t('admin.sponsoredQuests.title', 'Quest Title')}>
        <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className={adminInputClass} placeholder="e.g. Data Day Promo Quest" />
      </AdminField>
      <AdminField label={t('admin.sponsoredQuests.description', 'Description')}>
        <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} className={`${adminInputClass} resize-none`} placeholder={t('admin.sponsoredQuests.descriptionPlaceholder', 'What is this quest about?')} />
      </AdminField>
      <AdminField label={t('admin.sponsoredQuests.requirements', 'Requirements')}>
        <textarea value={form.requirements} onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))} rows={2} className={`${adminInputClass} resize-none`} placeholder={t('admin.sponsoredQuests.requirementsPlaceholder', 'What must creators do?')} />
      </AdminField>
      <div className="grid grid-cols-2 gap-2">
        <AdminField label={t('admin.sponsoredQuests.rewardCoins', 'Reward (Coins)')}>
          <input type="number" min="100" value={form.rewardCoins} onChange={(e) => setForm((f) => ({ ...f, rewardCoins: e.target.value }))} className={adminInputClass} />
        </AdminField>
        <AdminField label={t('admin.sponsoredQuests.creatorShare', 'Creator Share %')}>
          <input type="number" min="50" max="90" value={form.creatorSharePercent} onChange={(e) => setForm((f) => ({ ...f, creatorSharePercent: e.target.value }))} className={adminInputClass} />
        </AdminField>
      </div>
      <p className="text-[11px] text-neutral-400">
        {t('admin.sponsoredQuests.platformShareNote', 'Platform share: {{pct}}%', { pct: Math.max(0, 100 - (Number(form.creatorSharePercent) || 0)) })}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <AdminField label={t('admin.sponsoredQuests.maxApplications', 'Max Applications')}>
          <input type="number" min="1" value={form.maxApplications} onChange={(e) => setForm((f) => ({ ...f, maxApplications: e.target.value }))} className={adminInputClass} />
        </AdminField>
        <AdminField label={t('admin.sponsoredQuests.deadline', 'Deadline')}>
          <input type="datetime-local" value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} className={adminInputClass} />
        </AdminField>
      </div>
      <AdminField label={t('admin.sponsoredQuests.minCreatorTier', 'Min Creator Tier')}>
        <select value={form.minCreatorTier} onChange={(e) => setForm((f) => ({ ...f, minCreatorTier: e.target.value as CreatorTier }))} className={adminInputClass}>
          <option value="verified">{t('admin.sponsoredQuests.tierVerified', 'Verified Creator')}</option>
          <option value="elite">{t('admin.sponsoredQuests.tierElite', 'Elite Creator')}</option>
          <option value="icon">{t('admin.sponsoredQuests.tierIcon', 'Zobia Icon Creator')}</option>
        </select>
      </AdminField>
    </div>
  );
}

function AdminSponsoredQuestsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<QuestForm>(EMPTY_FORM);
  const [editTarget, setEditTarget] = useState<SponsoredQuest | null>(null);
  const [editForm, setEditForm] = useState<QuestForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<SponsoredQuest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<SponsoredQuest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data: quests, status, refetch } = useQuery({ queryKey: ['admin', 'sponsored-quests'], queryFn: fetchQuests });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'sponsored-quests'] });

  const createMutation = useMutation({
    mutationFn: () => apiClient.post('/admin/sponsored-quests', questFormToBody(createForm)),
    onSuccess: () => {
      showToast(t('admin.sponsoredQuests.published', 'Sponsored quest published successfully'));
      setShowCreate(false);
      setCreateForm(EMPTY_FORM);
      invalidate();
    },
    onError: () => showToast(t('admin.sponsoredQuests.saveFailed', 'Failed to create quest'), 'error'),
  });

  const editMutation = useMutation({
    mutationFn: () => apiClient.patch(`/admin/sponsored-quests/${editTarget!.id}`, questFormToBody(editForm)),
    onSuccess: () => {
      showToast(t('admin.sponsoredQuests.updated', 'Quest updated successfully'));
      setEditTarget(null);
      invalidate();
    },
    onError: () => showToast(t('admin.sponsoredQuests.saveFailed', 'Failed to save'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/sponsored-quests/${id}`),
    onSuccess: () => {
      showToast(t('admin.sponsoredQuests.deleted', 'Quest deleted'));
      setDeleteTarget(null);
      invalidate();
    },
    onError: () => showToast(t('admin.sponsoredQuests.deleteFailed', 'Failed to delete'), 'error'),
  });

  const toggleMutation = useMutation({
    mutationFn: (q: SponsoredQuest) => apiClient.patch(`/admin/sponsored-quests/${q.id}`, { isActive: !q.is_active }),
    onSuccess: (_res, q) => {
      showToast(q.is_active ? t('admin.sponsoredQuests.paused', 'Quest paused') : t('admin.sponsoredQuests.activated', 'Quest activated'));
      invalidate();
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const moderateMutation = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'approve' | 'reject'; reason?: string }) =>
      apiClient.post(`/admin/sponsored-quests/${id}/moderate`, { action, reason }),
    onSuccess: (_res, vars) => {
      showToast(vars.action === 'approve' ? t('admin.sponsoredQuests.approved', 'Quest approved and is now live') : t('admin.sponsoredQuests.rejected', 'Quest rejected'));
      setRejectTarget(null);
      setRejectReason('');
      invalidate();
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const openEdit = (q: SponsoredQuest) => {
    setEditTarget(q);
    setEditForm({
      brandName: q.brand_name,
      brandLogoUrl: '',
      title: q.title,
      description: q.description,
      requirements: q.requirements,
      rewardCoins: String(q.reward_coins),
      creatorSharePercent: String(q.creator_share_percent),
      maxApplications: String(q.max_applications),
      deadline: q.deadline ? q.deadline.slice(0, 16) : '',
      minCreatorTier: q.min_creator_tier as CreatorTier,
    });
  };

  return (
    <div className="px-4 py-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-neutral-900">{t('admin.nav.sponsoredQuests', 'Sponsored Quest Marketplace')}</h1>
        <button type="button" onClick={() => setShowCreate((v) => !v)} className="shrink-0 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white">
          {showCreate ? t('common.cancel') : t('admin.sponsoredQuests.publish', '+ Publish Quest')}
        </button>
      </div>
      <p className="mb-4 text-xs text-neutral-500">
        {t('admin.sponsoredQuests.subtitle', 'Publish quests on behalf of brands. Verified+ creators apply and earn a share of the reward.')}
      </p>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      {showCreate && (
        <AdminCard>
          <QuestFormFields form={createForm} setForm={setCreateForm} />
          <button
            type="button"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
            className="mt-4 w-full rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {createMutation.isPending ? '…' : t('admin.sponsoredQuests.publish', '+ Publish Quest')}
          </button>
        </AdminCard>
      )}

      <div className="mt-4 space-y-2.5">
        {status === 'pending' && Array.from({ length: 3 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && (quests?.length ?? 0) === 0 && (
          <AdminEmptyState icon="🎯" title={t('admin.sponsoredQuests.empty', 'No sponsored quests yet')} />
        )}
        {status === 'success' &&
          quests?.map((q) => (
            <AdminCard key={q.id}>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-semibold uppercase tracking-wide text-blue-600">{q.brand_name}</span>
                <AdminBadge label={q.is_active ? t('admin.sponsoredQuests.active', 'Active') : t('admin.sponsoredQuests.inactive', 'Inactive')} color={q.is_active ? 'green' : 'neutral'} />
                <AdminBadge label={t('admin.sponsoredQuests.minTierBadge', 'Min: {{tier}}', { tier: q.min_creator_tier })} color="gold" />
                {q.business_account_id && (
                  <AdminBadge
                    label={t('admin.sponsoredQuests.businessSubmission', 'Business{{who}} · {{status}}', {
                      who: q.submitted_by_username ? ` · @${q.submitted_by_username}` : '',
                      status: q.moderation_status,
                    })}
                    color={MOD_BADGE[q.moderation_status] ?? 'blue'}
                  />
                )}
              </div>
              <p className="font-semibold text-neutral-900">{q.title}</p>
              <p className="mt-0.5 line-clamp-2 text-sm text-neutral-500">{q.description}</p>
              {q.moderation_status === 'rejected' && q.moderation_reason && (
                <p className="mt-1 text-xs text-danger-600">{t('admin.sponsoredQuests.rejectionReason', 'Rejection reason')}: {q.moderation_reason}</p>
              )}

              <div className="mt-2 flex items-center justify-between">
                <div className="text-xs text-neutral-500">
                  📋 {q.application_count}/{q.max_applications} · ✅ {q.approved_count} · {fmtDate(q.deadline)}
                </div>
                <div className="text-right">
                  <p className="font-bold text-neutral-900">{fmtNumber(q.reward_coins)}</p>
                  <p className="text-[10px] text-neutral-400">{q.creator_share_percent}% / {q.platform_share_percent}%</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {q.moderation_status === 'pending' && (
                  <>
                    <button
                      type="button"
                      disabled={moderateMutation.isPending}
                      onClick={() => moderateMutation.mutate({ id: q.id, action: 'approve' })}
                      className="rounded-lg bg-success-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {t('admin.sponsoredQuests.approve', 'Approve')}
                    </button>
                    <button
                      type="button"
                      disabled={moderateMutation.isPending}
                      onClick={() => { setRejectTarget(q); setRejectReason(''); }}
                      className="rounded-lg bg-danger-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {t('admin.sponsoredQuests.reject', 'Reject')}
                    </button>
                  </>
                )}
                <button type="button" onClick={() => openEdit(q)} className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                  {t('admin.gifts.edit', 'Edit')}
                </button>
                <button
                  type="button"
                  disabled={toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate(q)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${q.is_active ? 'bg-amber-100 text-amber-700' : 'bg-success-100 text-success-700'}`}
                >
                  {q.is_active ? t('admin.sponsoredQuests.pause', 'Pause') : t('admin.sponsoredQuests.activate', 'Activate')}
                </button>
                <button type="button" onClick={() => setDeleteTarget(q)} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700">
                  {t('admin.sponsoredQuests.delete', 'Delete')}
                </button>
              </div>
            </AdminCard>
          ))}
      </div>

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-5">
            <h3 className="mb-4 font-semibold text-neutral-900">{t('admin.sponsoredQuests.editTitle', 'Edit Sponsored Quest')}</h3>
            <QuestFormFields form={editForm} setForm={setEditForm} />
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setEditTarget(null)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium text-neutral-700">
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={editMutation.isPending}
                onClick={() => editMutation.mutate()}
                className="flex-1 rounded-lg bg-primary-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {editMutation.isPending ? '…' : t('admin.gifts.saveChanges', 'Save Changes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectTarget && (
        <AdminConfirmDialog
          title={t('admin.sponsoredQuests.rejectTitle', 'Reject Sponsored Quest')}
          description={t('admin.sponsoredQuests.rejectDescription', 'Optionally provide a reason shown to the business owner.')}
          confirmLabel={t('admin.sponsoredQuests.reject', 'Reject')}
          cancelLabel={t('common.cancel')}
          danger
          pending={moderateMutation.isPending}
          onCancel={() => { setRejectTarget(null); setRejectReason(''); }}
          onConfirm={() => moderateMutation.mutate({ id: rejectTarget.id, action: 'reject', reason: rejectReason.trim() || undefined })}
        >
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder={t('admin.sponsoredQuests.rejectReasonPlaceholder', 'Reason for rejection (optional)')}
            rows={3}
            className={`${adminInputClass} resize-none text-sm`}
          />
        </AdminConfirmDialog>
      )}

      {deleteTarget && (
        <AdminConfirmDialog
          title={t('admin.sponsoredQuests.deleteTitle', 'Delete Quest?')}
          description={t('admin.sponsoredQuests.deleteDescription', '"{{title}}" will be soft-deleted and cannot be undone.', { title: deleteTarget.title })}
          confirmLabel={t('admin.sponsoredQuests.delete', 'Delete')}
          cancelLabel={t('common.cancel')}
          danger
          pending={deleteMutation.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/sponsored-quests')({
  component: AdminSponsoredQuestsPage,
});
