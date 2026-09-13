/**
 * apps/android/src/routes/admin/quests.tsx
 *
 * Quests Catalog — mirrors apps/web/app/(admin)/gate44/quests/page.tsx.
 * The base list of quest_templates rows the daily deck engine
 * (lib/quests/questEngine.ts generateDailyDeck) draws from — distinct from
 * /admin/quest-boosts (temporary per-feature weighting) and
 * /admin/sponsored-quests (advertiser-funded quests, managed separately and
 * excluded from this list).
 *
 * GET   /admin/quests -> { quests, featureKeys, actionTypes, tracks, statsWindowDays }
 * POST  /admin/quests (create)
 * PATCH /admin/quests/:id (edit fields / toggle isActive)
 *
 * Not editable here — see app/api/admin/quests/route.ts on web for why:
 *  - actionType (fixed once created — the string ~20 feature endpoints call
 *    to advance the quest; changing it later would silently disconnect it)
 *  - daily deck size per plan (3/4/5/6) and the 500 XP full-deck bonus —
 *    hardcoded constants in questEngine.ts, not data
 *  - sponsored-quest injection odds/CPM — data, but edited at /admin/config
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
  AdminToggle,
  AdminField,
  adminInputClass,
} from '@/components/admin/AdminUI';

interface Quest {
  id: string;
  title: string;
  description: string;
  action_type: string;
  target_count: number;
  xp_reward: number;
  coin_reward: number;
  category: string;
  icon: string | null;
  plan_required: string | null;
  track: string | null;
  feature_key: string | null;
  is_active: boolean;
  assigned_count: string;
  completed_count: string;
}

interface QuestsData {
  quests: Quest[];
  featureKeys: string[];
  actionTypes: string[];
  tracks: string[];
  statsWindowDays: number;
}

const FEATURE_LABELS: Record<string, string> = {
  games: 'Games',
  blogs: 'Blogs',
  wiki: 'Wiki',
  polls: 'Polls',
  quizzes: 'Quizzes',
  bbforum: 'Forum',
  gifts: 'Gifts',
  rooms: 'Rooms',
};

const PLAN_OPTIONS = ['free', 'plus', 'pro', 'max'];

interface QuestForm {
  title: string;
  description: string;
  actionType: string;
  targetCount: string;
  xpReward: string;
  coinReward: string;
  category: string;
  icon: string;
  planRequired: string;
  track: string;
  featureKey: string;
}

function emptyForm(actionTypes: string[], tracks: string[]): QuestForm {
  return {
    title: '',
    description: '',
    actionType: actionTypes[0] ?? '',
    targetCount: '1',
    xpReward: '100',
    coinReward: '0',
    category: 'general',
    icon: '⭐',
    planRequired: 'free',
    track: tracks[0] ?? 'main',
    featureKey: '',
  };
}

function completionRate(q: Quest): string {
  const assigned = parseInt(q.assigned_count, 10) || 0;
  const completed = parseInt(q.completed_count, 10) || 0;
  if (assigned === 0) return '—';
  return `${Math.round((completed / assigned) * 100)}%`;
}

async function fetchQuests(): Promise<QuestsData> {
  const { data } = await apiClient.get<QuestsData>('/admin/quests');
  return {
    quests: data?.quests ?? [],
    featureKeys: data?.featureKeys ?? [],
    actionTypes: data?.actionTypes ?? [],
    tracks: data?.tracks ?? [],
    statsWindowDays: data?.statsWindowDays ?? 30,
  };
}

function AdminQuestsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Quest | null>(null);
  const [form, setForm] = useState<QuestForm>(emptyForm([], []));
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'quests'], queryFn: fetchQuests });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'quests'] });

  const openCreate = () => {
    setEditTarget(null);
    setForm(emptyForm(data?.actionTypes ?? [], data?.tracks ?? []));
    setShowForm(true);
  };

  const openEdit = (q: Quest) => {
    setEditTarget(q);
    setForm({
      title: q.title,
      description: q.description,
      actionType: q.action_type,
      targetCount: String(q.target_count),
      xpReward: String(q.xp_reward),
      coinReward: String(q.coin_reward),
      category: q.category,
      icon: q.icon ?? '',
      planRequired: q.plan_required ?? 'free',
      track: q.track ?? 'main',
      featureKey: q.feature_key ?? '',
    });
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      if (editTarget) {
        return apiClient.patch(`/admin/quests/${editTarget.id}`, {
          title: form.title.trim(),
          description: form.description.trim(),
          targetCount: parseInt(form.targetCount, 10) || 1,
          xpReward: parseInt(form.xpReward, 10) || 0,
          coinReward: parseInt(form.coinReward, 10) || 0,
          category: form.category.trim() || 'general',
          icon: form.icon.trim() || null,
          planRequired: form.planRequired,
          track: form.track,
          featureKey: form.featureKey || null,
        });
      }
      return apiClient.post('/admin/quests', {
        title: form.title.trim(),
        description: form.description.trim(),
        actionType: form.actionType,
        targetCount: parseInt(form.targetCount, 10) || 1,
        xpReward: parseInt(form.xpReward, 10) || 0,
        coinReward: parseInt(form.coinReward, 10) || 0,
        category: form.category.trim() || 'general',
        icon: form.icon.trim() || undefined,
        planRequired: form.planRequired,
        track: form.track,
        featureKey: form.featureKey || undefined,
      });
    },
    onSuccess: () => {
      showToast(editTarget ? t('admin.questsCatalog.updated', 'Quest updated') : t('admin.questsCatalog.created', 'Quest created'));
      setShowForm(false);
      invalidate();
    },
    onError: () => showToast(t('admin.questsCatalog.saveFailed', 'Failed to save'), 'error'),
  });

  const toggleMutation = useMutation({
    mutationFn: (q: Quest) => apiClient.patch(`/admin/quests/${q.id}`, { isActive: !q.is_active }),
    onSuccess: () => invalidate(),
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const handleSubmit = () => {
    if (!form.title.trim() || !form.description.trim()) {
      showToast(t('admin.questsCatalog.formError', 'Title and description are required'), 'error');
      return;
    }
    saveMutation.mutate();
  };

  const quests = data?.quests ?? [];

  return (
    <div className="px-4 py-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{t('admin.nav.quests', 'Quests')}</h1>
        <button type="button" onClick={openCreate} className="shrink-0 rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-neutral-900 dark:text-neutral-100">
          {t('admin.questsCatalog.new', '+ New Quest')}
        </button>
      </div>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        {t(
          'admin.questsCatalog.subtitle',
          'The catalog of quest templates the daily deck engine draws from. See also Quest Boosts (temporary per-feature weighting) and Sponsored Quests (advertiser-funded, managed separately).'
        )}
      </p>
      <div className="mb-4 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 p-3 text-xs text-neutral-600 dark:text-neutral-400">
        {t(
          'admin.questsCatalog.hardcodedNote',
          'Not editable here: daily deck size per plan (free 3 / plus 4 / pro 5 / max 6) and the 500 XP full-deck bonus are hardcoded constants. Each quest’s action type is fixed once created — it’s the string feature code calls to advance progress.'
        )}
      </div>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 5 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && quests.length === 0 && (
          <AdminEmptyState icon="🗺️" title={t('admin.questsCatalog.empty', 'No quest templates found')} />
        )}
        {status === 'success' &&
          quests.map((q) => (
            <AdminCard key={q.id}>
              <div className="flex items-start gap-3">
                <span className="text-2xl">{q.icon ?? '⭐'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-semibold text-neutral-900 dark:text-neutral-100">{q.title}</p>
                    {q.feature_key && <AdminBadge label={FEATURE_LABELS[q.feature_key] ?? q.feature_key} color="blue" />}
                    {!q.is_active && <AdminBadge label={t('admin.questsCatalog.inactive', 'Inactive')} color="neutral" />}
                  </div>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">{q.description}</p>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {q.xp_reward} XP · {q.coin_reward} {t('admin.questsCatalog.credits', 'Credits')} · {t('admin.questsCatalog.target', 'Target')} {q.target_count} ·{' '}
                    {t('admin.questsCatalog.minPlan', 'Min')} {q.plan_required ?? 'free'} · {completionRate(q)} {t('admin.questsCatalog.rate30d', '(30d)')}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-neutral-400 dark:text-neutral-500">{q.action_type}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                  <AdminToggle checked={q.is_active} onChange={() => toggleMutation.mutate(q)} disabled={toggleMutation.isPending} />
                  {t('admin.questsCatalog.active', 'Active')}
                </label>
                <button type="button" onClick={() => openEdit(q)} className="rounded-lg bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  {t('admin.questsCatalog.edit', 'Edit')}
                </button>
              </div>
            </AdminCard>
          ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-neutral-800 p-5 max-h-[85vh] overflow-y-auto">
            <h3 className="mb-4 font-semibold text-neutral-900 dark:text-neutral-100">
              {editTarget ? t('admin.questsCatalog.editTitle', 'Edit "{{name}}"', { name: editTarget.title }) : t('admin.questsCatalog.newTitle', 'New Quest Template')}
            </h3>
            <div className="space-y-3">
              <AdminField label={t('admin.questsCatalog.titleLabel', 'Title')}>
                <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className={adminInputClass} placeholder="e.g. Poll Creator" />
              </AdminField>
              <AdminField label={t('admin.questsCatalog.description', 'Description')}>
                <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={adminInputClass} />
              </AdminField>
              <AdminField label={t('admin.questsCatalog.icon', 'Icon (emoji)')}>
                <input value={form.icon} onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))} className={adminInputClass} maxLength={8} />
              </AdminField>
              {!editTarget && (
                <AdminField label={t('admin.questsCatalog.actionType', 'Action type')}>
                  <select value={form.actionType} onChange={(e) => setForm((f) => ({ ...f, actionType: e.target.value }))} className={adminInputClass}>
                    {(data?.actionTypes ?? []).map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </AdminField>
              )}
              <div className="grid grid-cols-2 gap-2">
                <AdminField label={t('admin.questsCatalog.targetCount', 'Target count')}>
                  <input type="number" min="1" value={form.targetCount} onChange={(e) => setForm((f) => ({ ...f, targetCount: e.target.value }))} className={adminInputClass} />
                </AdminField>
                <AdminField label={t('admin.questsCatalog.category', 'Category')}>
                  <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className={adminInputClass} />
                </AdminField>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <AdminField label={t('admin.questsCatalog.xpReward', 'XP reward')}>
                  <input type="number" min="0" value={form.xpReward} onChange={(e) => setForm((f) => ({ ...f, xpReward: e.target.value }))} className={adminInputClass} />
                </AdminField>
                <AdminField label={t('admin.questsCatalog.coinReward', 'Credit reward')}>
                  <input type="number" min="0" value={form.coinReward} onChange={(e) => setForm((f) => ({ ...f, coinReward: e.target.value }))} className={adminInputClass} />
                </AdminField>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <AdminField label={t('admin.questsCatalog.minPlanLabel', 'Min plan')}>
                  <select value={form.planRequired} onChange={(e) => setForm((f) => ({ ...f, planRequired: e.target.value }))} className={adminInputClass}>
                    {PLAN_OPTIONS.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </AdminField>
                <AdminField label={t('admin.questsCatalog.trackLabel', 'XP track')}>
                  <select value={form.track} onChange={(e) => setForm((f) => ({ ...f, track: e.target.value }))} className={adminInputClass}>
                    {(data?.tracks ?? []).map((tr) => (
                      <option key={tr} value={tr}>{tr}</option>
                    ))}
                  </select>
                </AdminField>
              </div>
              <AdminField label={t('admin.questsCatalog.featureDependency', 'Feature dependency')}>
                <select value={form.featureKey} onChange={(e) => setForm((f) => ({ ...f, featureKey: e.target.value }))} className={adminInputClass}>
                  <option value="">{t('admin.questsCatalog.none', 'None (always eligible)')}</option>
                  {(data?.featureKeys ?? []).map((k) => (
                    <option key={k} value={k}>{FEATURE_LABELS[k] ?? k}</option>
                  ))}
                </select>
              </AdminField>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 rounded-lg border border-neutral-200 dark:border-neutral-700 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saveMutation.isPending}
                className="flex-1 rounded-lg bg-amber-400 py-2 text-sm font-bold text-neutral-900 dark:text-neutral-100 disabled:opacity-50"
              >
                {saveMutation.isPending ? '…' : editTarget ? t('admin.questsCatalog.saveChanges', 'Save Changes') : t('admin.questsCatalog.create', 'Create Quest')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/quests')({
  component: AdminQuestsPage,
});
