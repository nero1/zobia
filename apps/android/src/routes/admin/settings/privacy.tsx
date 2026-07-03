/**
 * apps/android/src/routes/admin/settings/privacy.tsx
 *
 * Profile Privacy Settings — mirrors apps/web/app/(admin)/admin/settings/privacy/page.tsx:
 * which plans/prestige ranks can lock their profile, hide profile sections,
 * or disable friend requests, plus which sections are hideable at all.
 * Values live in x_manifest as JSON-encoded arrays, read via the same
 * GET /api/admin/config the Config page uses.
 *
 * GET /api/admin/config           → RawManifestEntry[]
 * PUT /api/admin/config/:key      { value: JSON.stringify(string[]) }
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { AdminToast, AdminErrorState } from '@/components/admin/AdminUI';

const PLAN_OPTIONS = ['free', 'plus', 'pro', 'max'] as const;
const PRESTIGE_OPTIONS = ['prestige_1', 'prestige_2', 'prestige_5', 'prestige_10'] as const;
const ALL_SECTIONS = ['avatar', 'bio', 'rank', 'xp', 'guild', 'seasons', 'badges'] as const;

interface RawManifestEntry {
  key: string;
  value: string;
  description: string | null;
  updatedAt: string | null;
}

interface PrivacyConfig {
  canLockProfile: string[];
  canHideSections: string[];
  canDisableFriendRequests: string[];
  hideableSections: string[];
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

const DEFAULTS: PrivacyConfig = {
  canLockProfile: ['pro', 'max', 'prestige_1'],
  canHideSections: ['plus', 'pro', 'max', 'prestige_1'],
  canDisableFriendRequests: ['plus', 'pro', 'max', 'prestige_1'],
  hideableSections: [...ALL_SECTIONS],
};

async function fetchPrivacyConfig(): Promise<PrivacyConfig> {
  const { data } = await apiClient.get<RawManifestEntry[]>('/admin/config');
  const entries = data ?? [];
  const get = (key: string) => entries.find((e) => e.key === key)?.value;
  return {
    canLockProfile: parseJsonList(get('privacy_can_lock_profile'), DEFAULTS.canLockProfile),
    canHideSections: parseJsonList(get('privacy_can_hide_sections'), DEFAULTS.canHideSections),
    canDisableFriendRequests: parseJsonList(get('privacy_can_disable_friend_requests'), DEFAULTS.canDisableFriendRequests),
    hideableSections: parseJsonList(get('privacy_hideable_sections'), DEFAULTS.hideableSections),
  };
}

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
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

function SettingBlock({
  titleKey,
  titleDefault,
  descKey,
  descDefault,
  values,
  saving,
  onChange,
  onSave,
}: {
  titleKey: string;
  titleDefault: string;
  descKey: string;
  descDefault: string;
  values: string[];
  saving: boolean;
  onChange: (next: string[]) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card">
      <div className="border-b border-neutral-200 px-4 py-3.5">
        <h2 className="text-sm font-semibold text-neutral-900">{t(titleKey, titleDefault)}</h2>
        <p className="mt-0.5 text-xs text-neutral-500">{t(descKey, descDefault)}</p>
      </div>
      <div className="p-4">
        <div className="mb-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{t('admin.privacySettings.plans', 'Plans')}</p>
          <div className="flex flex-wrap gap-2">
            {PLAN_OPTIONS.map((plan) => (
              <Chip key={plan} value={plan} active={values.includes(plan)} onToggle={(v) => onChange(toggleInList(values, v))} label={plan.charAt(0).toUpperCase() + plan.slice(1)} />
            ))}
          </div>
        </div>
        <div className="mb-4">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{t('admin.privacySettings.prestigeRanks', 'Prestige Ranks')}</p>
          <div className="flex flex-wrap gap-2">
            {PRESTIGE_OPTIONS.map((p) => (
              <Chip key={p} value={p} active={values.includes(p)} onToggle={(v) => onChange(toggleInList(values, v))} label={p.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())} />
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? '…' : t('common.confirm', 'Save')}
        </button>
      </div>
    </div>
  );
}

function AdminPrivacySettingsPage() {
  const { t } = useTranslation();
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState<PrivacyConfig | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'privacy-settings'], queryFn: fetchPrivacyConfig });
  const config = draft ?? data ?? DEFAULTS;

  const saveMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string[] }) => apiClient.put(`/admin/config/${key}`, { value: JSON.stringify(value) }),
    onMutate: ({ key }) => setSavingKey(key),
    onSuccess: () => showToast(t('admin.privacySettings.saved', 'Saved')),
    onError: () => showToast(t('admin.privacySettings.saveError', 'Error saving — please try again')),
    onSettled: () => setSavingKey(null),
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
      <h1 className="text-xl font-bold text-neutral-900">{t('admin.nav.privacySettings', 'Profile Privacy Settings')}</h1>
      <p className="mb-4 mt-1 text-xs text-neutral-500">
        {t('admin.privacySettings.subtitle', 'Control which plans and ranks can access each privacy feature. Changes take effect within 60 seconds.')}
      </p>

      {toast && <AdminToast message={toast} />}

      {status === 'pending' && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-xl border border-neutral-200 bg-white" />)}
        </div>
      )}

      {status === 'success' && (
        <div className="space-y-3">
          <SettingBlock
            titleKey="admin.privacySettings.lockProfile.title"
            titleDefault="Who can lock (privatise) their profile"
            descKey="admin.privacySettings.lockProfile.desc"
            descDefault="Users on these plans/ranks can hide their profile from non-friends."
            values={config.canLockProfile}
            saving={savingKey === 'privacy_can_lock_profile'}
            onChange={(next) => setDraft({ ...config, canLockProfile: next })}
            onSave={() => saveMutation.mutate({ key: 'privacy_can_lock_profile', value: config.canLockProfile })}
          />
          <SettingBlock
            titleKey="admin.privacySettings.hideSections.title"
            titleDefault="Who can hide profile sections"
            descKey="admin.privacySettings.hideSections.desc"
            descDefault="Users on these plans/ranks can individually hide sections of their profile."
            values={config.canHideSections}
            saving={savingKey === 'privacy_can_hide_sections'}
            onChange={(next) => setDraft({ ...config, canHideSections: next })}
            onSave={() => saveMutation.mutate({ key: 'privacy_can_hide_sections', value: config.canHideSections })}
          />
          <SettingBlock
            titleKey="admin.privacySettings.disableFriendRequests.title"
            titleDefault="Who can disable friend requests"
            descKey="admin.privacySettings.disableFriendRequests.desc"
            descDefault="Users on these plans/ranks can prevent others from sending them friend requests."
            values={config.canDisableFriendRequests}
            saving={savingKey === 'privacy_can_disable_friend_requests'}
            onChange={(next) => setDraft({ ...config, canDisableFriendRequests: next })}
            onSave={() => saveMutation.mutate({ key: 'privacy_can_disable_friend_requests', value: config.canDisableFriendRequests })}
          />

          <div className="rounded-xl border border-neutral-200 bg-white shadow-card">
            <div className="border-b border-neutral-200 px-4 py-3.5">
              <h2 className="text-sm font-semibold text-neutral-900">{t('admin.privacySettings.hideableSections.title', 'Available sections to hide')}</h2>
              <p className="mt-0.5 text-xs text-neutral-500">{t('admin.privacySettings.hideableSections.desc', 'Choose which profile sections users are allowed to hide. Unchecked sections will always be visible.')}</p>
            </div>
            <div className="p-4">
              <div className="mb-4 flex flex-wrap gap-2">
                {ALL_SECTIONS.map((section) => (
                  <Chip
                    key={section}
                    value={section}
                    active={config.hideableSections.includes(section)}
                    onToggle={(v) => setDraft({ ...config, hideableSections: toggleInList(config.hideableSections, v) })}
                    label={section.charAt(0).toUpperCase() + section.slice(1)}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => saveMutation.mutate({ key: 'privacy_hideable_sections', value: config.hideableSections })}
                disabled={savingKey === 'privacy_hideable_sections'}
                className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {savingKey === 'privacy_hideable_sections' ? '…' : t('common.confirm', 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/settings/privacy')({
  component: AdminPrivacySettingsPage,
});
