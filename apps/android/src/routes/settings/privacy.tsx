/**
 * apps/android/src/routes/settings/privacy.tsx
 *
 * Privacy settings — BUG-CAP-07 fix: this screen didn't exist at all on
 * Android, so mobile-only users had no way to see or change these settings
 * without switching to a browser. Mirrors apps/web/app/(app)/settings/page.tsx's
 * "Privacy" section against the same GET/PATCH /api/users/me/privacy endpoint
 * (plan-gated capabilities included), so no backend changes were needed.
 */

import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface PrivacySettings {
  profile_private: boolean;
  disable_friend_requests: boolean;
  show_online_status: boolean;
  sitemap_opt_out: boolean;
}

interface PrivacyCapabilities {
  canLockProfile: boolean;
  canDisableFriendRequests: boolean;
  canShowOnlineStatus: boolean;
}

const DEFAULT_SETTINGS: PrivacySettings = {
  profile_private: false,
  disable_friend_requests: false,
  show_online_status: false,
  sitemap_opt_out: false,
};

const DEFAULT_CAPS: PrivacyCapabilities = {
  canLockProfile: false,
  canDisableFriendRequests: false,
  canShowOnlineStatus: false,
};

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? 'bg-primary-600' : 'bg-neutral-300'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function PrivacyRow({
  title,
  description,
  checked,
  onChange,
  disabled,
  gated,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  gated?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 py-3 ${gated ? 'opacity-60' : ''}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-neutral-900">{title}</p>
        <p className="text-xs text-neutral-500">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled || gated} />
    </div>
  );
}

function PrivacyPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<PrivacySettings>(DEFAULT_SETTINGS);
  const [caps, setCaps] = useState<PrivacyCapabilities>(DEFAULT_CAPS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient
      .get<{ settings: PrivacySettings; capabilities: PrivacyCapabilities }>('/users/me/privacy')
      .then(({ data }) => {
        setSettings(data.settings);
        setCaps(data.capabilities);
      })
      .catch(() => { /* keep defaults — section still renders, just unsaved */ })
      .finally(() => setLoading(false));
  }, []);

  async function save(patch: Partial<PrivacySettings>) {
    const previous = settings;
    setSettings((prev) => ({ ...prev, ...patch }));
    setSaving(true);
    try {
      await apiClient.patch('/users/me/privacy', patch);
    } catch {
      setSettings(previous); // revert on failure
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-neutral-400">{t('action.loading', 'Loading…')}</div>;
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <div className="divide-y divide-neutral-100 rounded-xl bg-white px-4 shadow-card">
        <PrivacyRow
          title={t('settings.privacy.disableFriendRequests', 'Disable friend requests')}
          description={t('settings.privacy.disableFriendRequestsDesc', 'Prevent others from sending you friend requests')}
          checked={settings.disable_friend_requests}
          onChange={(v) => void save({ disable_friend_requests: v })}
          disabled={saving}
          gated={!caps.canDisableFriendRequests}
        />
        <PrivacyRow
          title={t('settings.privacy.privateProfile', 'Private profile')}
          description={t('settings.privacy.privateProfileDesc', 'Only friends can view your profile details')}
          checked={settings.profile_private}
          onChange={(v) => void save({ profile_private: v })}
          disabled={saving}
          gated={!caps.canLockProfile}
        />
        <PrivacyRow
          title={t('settings.privacy.showOnlineStatus', 'Show online status')}
          description={t('settings.privacy.showOnlineStatusDesc', "Let friends see when you're online")}
          checked={settings.show_online_status}
          onChange={(v) => void save({ show_online_status: v })}
          disabled={saving}
          gated={!caps.canShowOnlineStatus}
        />
        <PrivacyRow
          title={t('settings.privacy.sitemapOptOut', 'Hide from search engines')}
          description={t('settings.privacy.sitemapOptOutDesc', 'Exclude your profile from the public sitemap')}
          checked={settings.sitemap_opt_out}
          onChange={(v) => void save({ sitemap_opt_out: v })}
          disabled={saving}
        />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/settings/privacy')({
  component: PrivacyPage,
});
