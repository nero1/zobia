/**
 * apps/android/src/routes/admin/settings/profile-stats.tsx
 *
 * Profile Stats Settings — mirrors apps/web/app/(admin)/admin/settings/profile-stats/page.tsx:
 * which plans/prestige tiers get the "Full" Stats view (detailed leaderboard
 * positions + season history) vs the "Basic" view. The master on/off switch
 * for the whole Stats page lives on Feature Flags (key: feature_profile_stats).
 *
 * GET /api/admin/config                              → RawManifestEntry[]
 * PUT /api/admin/config/profile_stats_full_plans      { value: JSON.stringify(string[]) }
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { AdminToast, AdminErrorState } from '@/components/admin/AdminUI';

const PLAN_OPTIONS = ['free', 'plus', 'pro', 'max'] as const;
const PRESTIGE_OPTIONS = ['prestige_1', 'prestige_2', 'prestige_5', 'prestige_10'] as const;
const DEFAULT_FULL_PLANS = ['plus', 'pro', 'max'];

interface RawManifestEntry {
  key: string;
  value: string;
  description: string | null;
  updatedAt: string | null;
}

function parseJsonList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : fallback;
  } catch {
    return fallback;
  }
}

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

async function fetchFullPlans(): Promise<string[]> {
  const { data } = await apiClient.get<RawManifestEntry[]>('/admin/config');
  const entries = data ?? [];
  return parseJsonList(entries.find((e) => e.key === 'profile_stats_full_plans')?.value, DEFAULT_FULL_PLANS);
}

function Chip({ value, active, onToggle, label }: { value: string; active: boolean; onToggle: (v: string) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(value)}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${active ? 'bg-primary-600 text-white' : 'border border-neutral-300 text-neutral-600'}`}
    >
      {label}
    </button>
  );
}

function AdminProfileStatsSettingsPage() {
  const { t } = useTranslation();
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[] | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'profile-stats-settings'], queryFn: fetchFullPlans });
  const fullPlans = draft ?? data ?? DEFAULT_FULL_PLANS;

  const saveMutation = useMutation({
    mutationFn: (value: string[]) => apiClient.put('/admin/config/profile_stats_full_plans', { value: JSON.stringify(value) }),
    onSuccess: () => showToast(t('admin.profileStats.saved', 'Saved')),
    onError: () => showToast(t('admin.profileStats.saveError', 'Error saving — please try again')),
  });

  if (status === 'error') {
    return (
      <div className="px-4 py-5">
        <AdminErrorState onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <div className="px-4 py-5">
      <h1 className="text-xl font-bold text-neutral-900">{t('admin.nav.profileStats', 'Profile Stats Settings')}</h1>
      <p className="mb-1 mt-1 text-xs text-neutral-500">
        {t('admin.profileStats.subtitle', 'Control which plans and prestige ranks get the Full Stats view. Everyone else sees the Basic Stats view.')}
      </p>
      <p className="mb-4 text-xs text-neutral-500">
        {t('admin.profileStats.masterSwitchHint', 'The master on/off switch for the Stats page lives on {{featureFlagsLabel}} (key: feature_profile_stats). Changes take effect within 60 seconds.', {
          featureFlagsLabel: t('admin.nav.featureFlags', 'Feature Flags'),
        })}{' '}
        <Link to="/admin/feature-flags" className="text-primary-600 underline">
          {t('admin.nav.featureFlags', 'Feature Flags')} →
        </Link>
      </p>

      {toast && <AdminToast message={toast} />}

      {status === 'pending' && <div className="h-32 animate-pulse rounded-xl border border-neutral-200 bg-white" />}

      {status === 'success' && (
        <div className="rounded-xl border border-neutral-200 bg-white shadow-card">
          <div className="border-b border-neutral-200 px-4 py-3.5">
            <h2 className="text-sm font-semibold text-neutral-900">{t('admin.profileStats.whoGetsFull.title', 'Who gets the Full Stats view')}</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {t(
                'admin.profileStats.whoGetsFull.desc',
                'Users on these plans/ranks see detailed leaderboard positions (every track, every scope) and season history on their Stats page. Everyone else sees the Basic view: badges, levels, achievements, created rooms, and social counts only.',
              )}
            </p>
          </div>
          <div className="p-4">
            <div className="mb-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{t('admin.privacySettings.plans', 'Plans')}</p>
              <div className="flex flex-wrap gap-2">
                {PLAN_OPTIONS.map((plan) => (
                  <Chip key={plan} value={plan} active={fullPlans.includes(plan)} onToggle={(v) => setDraft(toggleInList(fullPlans, v))} label={plan.charAt(0).toUpperCase() + plan.slice(1)} />
                ))}
              </div>
            </div>
            <div className="mb-4">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{t('admin.privacySettings.prestigeRanks', 'Prestige Ranks')}</p>
              <div className="flex flex-wrap gap-2">
                {PRESTIGE_OPTIONS.map((p) => (
                  <Chip key={p} value={p} active={fullPlans.includes(p)} onToggle={(v) => setDraft(toggleInList(fullPlans, v))} label={p.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())} />
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={() => saveMutation.mutate(fullPlans)}
              disabled={saveMutation.isPending}
              className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saveMutation.isPending ? '…' : t('common.confirm', 'Save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/settings/profile-stats')({
  component: AdminProfileStatsSettingsPage,
});
