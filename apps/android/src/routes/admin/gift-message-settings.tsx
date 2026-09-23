/**
 * apps/android/src/routes/admin/gift-message-settings.tsx
 *
 * Mirrors apps/web/app/(admin)/gate44/gifts/message-settings/page.tsx —
 * the optional "Add a message" box on Send Gift. Global on/off + Free
 * plan's minimum level, and per plan/business-tier on/off + max words.
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { AdminToast, AdminField, adminInputClass } from '@/components/admin/AdminUI';

interface ConfigEntry {
  key: string;
  value: string;
}

const TIERS: { tier: string; label: string }[] = [
  { tier: 'free', label: 'Free' },
  { tier: 'plus', label: 'Plus' },
  { tier: 'pro', label: 'Pro' },
  { tier: 'max', label: 'Max' },
  { tier: 'business_starter', label: 'Business Starter' },
  { tier: 'business_growth', label: 'Business Growth' },
  { tier: 'business_enterprise', label: 'Business Enterprise' },
];

async function fetchConfig(): Promise<Record<string, string>> {
  const { data } = await apiClient.get<{ data?: ConfigEntry[]; entries?: ConfigEntry[] }>('/admin/config');
  const entries = data?.data ?? data?.entries ?? [];
  const map: Record<string, string> = {};
  for (const e of entries) map[e.key] = e.value;
  return map;
}

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-primary-600' : 'bg-neutral-300 dark:bg-neutral-700'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function GiftMessageSettingsPage() {
  const qc = useQueryClient();
  const { data: values, status } = useQuery({ queryKey: ['admin', 'gift-message-settings'], queryFn: fetchConfig });
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const save = async (key: string, value: string) => {
    setSaving(key);
    try {
      await apiClient.put(`/admin/config/${key}`, { value });
      qc.setQueryData<Record<string, string>>(['admin', 'gift-message-settings'], (prev) => ({ ...(prev ?? {}), [key]: value }));
      showToast('Saved');
    } catch {
      showToast('Save failed', 'error');
    } finally {
      setSaving(null);
    }
  };

  if (status === 'pending') {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />)}
      </div>
    );
  }

  const v = values ?? {};

  return (
    <div className="p-4 pb-10">
      <h1 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">Gift Message Settings</h1>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        The optional &quot;Add a message&quot; box on Send Gift. Free unlocks at a minimum level; every plan/tier has its
        own toggle and max-word limit.
      </p>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <div className="mb-4 space-y-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Gift Messages Enabled</p>
          <ToggleSwitch
            checked={v['gift_message_enabled'] === 'true'}
            disabled={saving === 'gift_message_enabled'}
            onChange={(val) => void save('gift_message_enabled', val ? 'true' : 'false')}
          />
        </div>
        <AdminField label="Free Plan — Minimum Level">
          <input
            type="number"
            defaultValue={v['gift_message_free_min_level'] ?? ''}
            disabled={saving === 'gift_message_free_min_level'}
            onBlur={(e) => { if (e.target.value !== v['gift_message_free_min_level']) void save('gift_message_free_min_level', e.target.value); }}
            className={adminInputClass}
          />
        </AdminField>
      </div>

      <div className="space-y-2">
        {TIERS.map(({ tier, label }) => {
          const enabledKey = `gift_message_enabled_${tier}`;
          const maxWordsKey = `gift_message_max_words_${tier}`;
          return (
            <div key={tier} className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{label}</p>
                <ToggleSwitch
                  checked={v[enabledKey] === 'true'}
                  disabled={saving === enabledKey}
                  onChange={(val) => void save(enabledKey, val ? 'true' : 'false')}
                />
              </div>
              <AdminField label="Max words">
                <input
                  type="number"
                  defaultValue={v[maxWordsKey] ?? ''}
                  disabled={saving === maxWordsKey}
                  onBlur={(e) => { if (e.target.value !== v[maxWordsKey]) void save(maxWordsKey, e.target.value); }}
                  className={adminInputClass}
                />
              </AdminField>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/admin/gift-message-settings')({
  component: GiftMessageSettingsPage,
});
