/**
 * apps/android/src/routes/settings.tsx
 *
 * Settings screen: language, logout, app version.
 */

import { useEffect, useRef, useState } from 'react';
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App } from '@capacitor/app';
import { useAuth } from '@/lib/auth/store';
import { apiClient } from '@/lib/api/client';
import { restorePurchases } from '@/lib/payments/googlePlay';
import { LOCALE_LABELS, SUPPORTED_LOCALES, type SupportedLocale } from '@zobia/shared/i18n';
import { DEFAULT_AVATAR_EMOJIS } from '@zobia/shared/utils';
import i18n from '@/lib/i18n';
import { useFeatureFlags, useFeatureModVisibility, resolveFeatureAccess } from '@/lib/hooks/useManifest';
import { useTweetsConfig } from '@/lib/hooks/useTweetsConfig';
import { useTweetLengthPolicy } from '@/lib/hooks/useTweetLengthPolicy';
import { AvatarCropModal } from '@/components/profile/AvatarCropModal';

// ZB-AND-09 fix: restorePurchases() was fully implemented in
// lib/payments/googlePlay.ts but had no UI entry point anywhere in the app —
// a user who reinstalled or switched devices had no way to recover
// entitlements without contacting support.
function RestorePurchasesSection() {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'restoring' | 'success' | 'error'>('idle');

  async function handleRestore() {
    setState('restoring');
    const result = await restorePurchases();
    setState(result.error ? 'error' : 'success');
  }

  return (
    <div className="bg-white px-6 py-4 mb-3">
      <h3 className="text-sm font-semibold text-neutral-700 mb-1">{t('settings.restorePurchases.title')}</h3>
      <p className="text-xs text-neutral-500 mb-3">{t('settings.restorePurchases.desc')}</p>
      <button
        onClick={() => void handleRestore()}
        disabled={state === 'restoring'}
        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
      >
        {state === 'restoring' ? t('settings.restorePurchases.restoring') : t('settings.restorePurchases.button')}
      </button>
      {state === 'success' && <p className="mt-2 text-xs text-green-600">{t('settings.restorePurchases.success')}</p>}
      {state === 'error' && <p className="mt-2 text-xs text-danger-600">{t('settings.restorePurchases.error')}</p>}
    </div>
  );
}

// Gender sub-section — mirrors web's settings "Gender" pill selector, saved
// via PUT /api/users/me (same endpoint web uses).
type Gender = 'male' | 'female' | 'non_binary' | 'prefer_not_to_say';

function GenderSection() {
  const { t } = useTranslation();
  const [gender, setGender] = useState<Gender | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient
      .get<{ user?: { gender?: Gender | null } }>('/users/me')
      .then(({ data }) => {
        if (data.user?.gender) setGender(data.user.gender);
      })
      .catch(() => { /* non-fatal */ });
  }, []);

  async function save(value: Gender) {
    const previous = gender;
    setGender(value);
    setSaving(true);
    try {
      await apiClient.put('/users/me', { gender: value });
    } catch {
      setGender(previous); // revert on failure
    } finally {
      setSaving(false);
    }
  }

  const options: { value: Gender; label: string }[] = [
    { value: 'male', label: t('settings.gender.male', 'Male') },
    { value: 'female', label: t('settings.gender.female', 'Female') },
    { value: 'non_binary', label: t('settings.gender.other', 'Other') },
    { value: 'prefer_not_to_say', label: t('settings.gender.preferNotToSay', 'Prefer not to say') },
  ];

  return (
    <div className="bg-white px-6 py-4 mb-3">
      <h3 className="text-sm font-semibold text-neutral-700 mb-3">{t('settings.gender.label', 'Gender')}</h3>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => void save(opt.value)}
            disabled={saving}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${
              gender === opt.value
                ? 'bg-primary-600 text-white'
                : 'border border-neutral-300 text-neutral-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// BUG-CAP-07: Data & Account sub-section — request-my-data + delete account.
// Rendered inline (not a separate route) to mirror web's settings page,
// which keeps both in the main Settings screen rather than a nested page.
function DataAndAccountSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { clearAuth } = useAuth();
  const qc = useQueryClient();

  const [exporting, setExporting] = useState(false);
  const [exportedJson, setExportedJson] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function handleExport() {
    setExporting(true);
    setExportedJson(null);
    try {
      // The response embeds the export as a `data:application/json;base64,...`
      // URI in the JSON body itself (see app/api/users/me/export/route.ts) —
      // decoded and shown inline rather than opened via Browser.open(), since
      // Chrome Custom Tabs (what Browser.open() uses) refuse to navigate to
      // data: URIs. Long-press → Share/Copy on the text below works natively,
      // no extra native dependency needed.
      const { data } = await apiClient.post<{ downloadUrl: string }>('/users/me/export');
      const base64 = data.downloadUrl.split(',')[1] ?? '';
      const decoded = decodeURIComponent(escape(atob(base64)));
      setExportedJson(decoded);
    } catch {
      // non-fatal — user can retry
    } finally {
      setExporting(false);
    }
  }

  async function handleCopy() {
    if (!exportedJson) return;
    try {
      await navigator.clipboard.writeText(exportedJson);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch { /* clipboard unavailable — text is still selectable */ }
  }

  async function handleDeleteAccount() {
    if (deleteConfirmText !== 'DELETE') return;
    setDeleting(true);
    try {
      await apiClient.delete('/users/me');
      await clearAuth();
      qc.clear();
      navigate({ to: '/auth/login', replace: true });
    } catch {
      setDeleting(false);
    }
  }

  return (
    <div className="bg-white px-6 py-4 mb-3">
      <h3 className="text-sm font-semibold text-neutral-700 mb-3">{t('settings.dataAccount.title', 'Data & Account')}</h3>

      <div className="mb-4">
        <p className="text-xs text-neutral-500 mb-2">
          {t('settings.dataAccount.exportDesc', 'Download a copy of your account data.')}
        </p>
        <button
          onClick={() => void handleExport()}
          disabled={exporting}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
        >
          {exporting ? t('settings.dataAccount.exporting', 'Preparing…') : t('settings.dataAccount.export', 'Request my data')}
        </button>
        {exportedJson && (
          <div className="mt-2">
            <pre className="max-h-40 overflow-auto rounded-lg bg-neutral-100 p-2 text-[10px] text-neutral-700 select-all">{exportedJson}</pre>
            <button onClick={() => void handleCopy()} className="mt-1 text-xs font-semibold text-primary-600">
              {copyState === 'copied' ? t('settings.dataAccount.copied', 'Copied!') : t('settings.dataAccount.copy', 'Copy to clipboard')}
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-neutral-100 pt-4">
        <p className="text-xs text-neutral-500 mb-2">{t('settings.dataAccount.deleteDesc', 'Permanently delete your account and all associated data.')}</p>
        {!showDeleteConfirm ? (
          <button onClick={() => setShowDeleteConfirm(true)} className="rounded-lg border border-danger-300 px-3 py-1.5 text-xs font-semibold text-danger-600">
            {t('settings.dataAccount.delete', 'Delete account')}
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-neutral-600">
              {t('settings.dataAccount.deleteConfirmHint', 'Type DELETE to confirm — this cannot be undone.')}
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={() => void handleDeleteAccount()}
                disabled={deleteConfirmText !== 'DELETE' || deleting}
                className="rounded-lg bg-danger-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                {deleting ? t('settings.dataAccount.deleting', 'Deleting…') : t('settings.dataAccount.confirmDelete', 'Permanently delete')}
              </button>
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); }}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold"
              >
                {t('action.cancel', 'Cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Tweets — personal max Tweet length. Mirrors apps/web/app/(app)/settings/page.tsx's
// "Tweets" Section: GET /api/tweets/policy (via useTweetLengthPolicy) for the
// current value/limits, PATCH /api/users/me/settings { tweetMaxLength } to save
// (same generic settings endpoint web's saveField() falls through to for fields
// with no dedicated route). Gated on useTweetsConfig().enabled like web's
// tweetsConfig.enabled check.
function TweetLengthSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const policy = useTweetLengthPolicy();
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current && policy.personalMaxLength) {
      setInput(String(policy.personalMaxLength));
      initialized.current = true;
    }
  }, [policy.personalMaxLength]);

  async function handleSave() {
    const n = parseInt(input, 10);
    if (!Number.isFinite(n)) return;
    setSaving(true);
    try {
      await apiClient.patch('/users/me/settings', { tweetMaxLength: n });
      await qc.invalidateQueries({ queryKey: ['tweets', 'policy'] });
    } catch {
      // non-fatal — input keeps whatever the user typed, they can retry
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white px-6 py-4 mb-3">
      <h3 className="text-sm font-semibold text-neutral-700 mb-1">{t('tweets.title')}</h3>
      <label className="mb-1 mt-2 block text-xs font-semibold text-neutral-700">
        {t('settings.tweetMaxLength.label')}
      </label>
      <p className="mb-2 text-xs text-neutral-500">
        {policy.isLongFormExempt
          ? t('settings.tweetMaxLength.hintExempt', { max: policy.longMaxLengthChars })
          : t('settings.tweetMaxLength.hint', { default: policy.defaultMaxLength, cost: policy.longTweetCostCredits })}
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={policy.defaultMaxLength}
          max={policy.longMaxLengthChars}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onBlur={() => void handleSave()}
          disabled={saving}
          className="w-28 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-40"
        />
      </div>
    </div>
  );
}

// Profile Pictures feature — mirrors apps/web/app/(app)/settings/page.tsx's
// avatar section. Fetches avatar_url/avatar_emoji directly (not carried on
// the cached AuthUser) since they can change without a re-login.
interface AvatarProfile {
  avatar_url: string | null;
  avatar_emoji: string | null;
}

function ProfilePhotoSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [showDefaultIconPicker, setShowDefaultIconPicker] = useState(false);
  const [savingIcon, setSavingIcon] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['users', 'me', 'avatar-profile'],
    queryFn: async () => {
      const { data } = await apiClient.get<{ user: AvatarProfile }>('/users/me');
      return data.user;
    },
  });

  async function selectDefaultIcon(emoji: string) {
    setSavingIcon(emoji);
    try {
      await apiClient.put('/users/me', { avatar_emoji: emoji });
      qc.setQueryData(['users', 'me', 'avatar-profile'], { avatar_url: null, avatar_emoji: emoji });
      setShowDefaultIconPicker(false);
      setToast(t('profile.avatar.iconUpdated'));
    } catch {
      setToast(t('profile.avatar.uploadFailed'));
    } finally {
      setSavingIcon(null);
      setTimeout(() => setToast(null), 3000);
    }
  }

  return (
    <div className="bg-white px-6 py-4 mb-3">
      <h3 className="text-sm font-semibold text-neutral-700 mb-3">{t('profile.avatar.sectionLabel')}</h3>
      <div className="flex items-center gap-4">
        {data?.avatar_url ? (
          <img src={data.avatar_url} alt="" className="w-16 h-16 rounded-full object-cover" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center text-2xl">
            {data?.avatar_emoji ?? '👤'}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold"
            >
              {t('profile.avatar.uploadPhoto')}
            </button>
            <button
              onClick={() => setShowDefaultIconPicker((v) => !v)}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold"
            >
              {t('profile.avatar.useDefaultIcon')}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setCropImageSrc(URL.createObjectURL(file));
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {showDefaultIconPicker && (
        <div className="mt-3 flex flex-wrap gap-2">
          {DEFAULT_AVATAR_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              disabled={savingIcon !== null}
              onClick={() => void selectDefaultIcon(emoji)}
              className={`h-10 w-10 rounded-full text-xl disabled:opacity-50 ${
                data?.avatar_emoji === emoji ? 'ring-2 ring-primary-500 ring-offset-2' : ''
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {toast && <p className="mt-2 text-xs text-neutral-600">{toast}</p>}

      {cropImageSrc && (
        <AvatarCropModal
          imageSrc={cropImageSrc}
          onClose={() => {
            URL.revokeObjectURL(cropImageSrc);
            setCropImageSrc(null);
          }}
          onUploaded={(newUrl) => {
            qc.setQueryData(['users', 'me', 'avatar-profile'], { avatar_url: newUrl, avatar_emoji: null });
            setToast(t('profile.avatar.photoUpdated'));
            setTimeout(() => setToast(null), 3000);
          }}
        />
      )}
    </div>
  );
}

// BUG-CAP-11 fix: fallback only, used if App.getInfo() throws (e.g. running
// in a plain browser during `npm run dev`, where the native App plugin is a
// no-op). The real value always comes from the installed APK's manifest.
const FALLBACK_APP_VERSION = '1.0.0';

function SettingsPage() {
  const { t } = useTranslation();
  const { user, clearAuth } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [appVersion, setAppVersion] = useState(FALLBACK_APP_VERSION);
  const featureFlags = useFeatureFlags();
  const modVisibleKeys = useFeatureModVisibility();
  const tweetsConfig = useTweetsConfig();
  const statsAccess = resolveFeatureAccess(
    featureFlags?.profileStats !== false,
    modVisibleKeys.includes('profileStats'),
    { isAdmin: user?.is_admin, isModerator: user?.is_moderator }
  );

  useEffect(() => {
    App.getInfo()
      .then((info) => setAppVersion(info.version))
      .catch(() => { /* keep FALLBACK_APP_VERSION — not running in a native shell */ });
  }, []);

  const handleLogout = async () => {
    await clearAuth();
    qc.clear();
    navigate({ to: '/auth/login', replace: true });
  };

  const handleLanguageChange = async (lng: string) => {
    await i18n.changeLanguage(lng);
  };

  return (
    <div className="h-full overflow-y-auto bg-neutral-50">
      {/* Current user */}
      {user && (
        <div className="bg-white px-6 py-4 mb-3 flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center text-2xl">
            👤
          </div>
          <div>
            <p className="font-semibold text-neutral-900">{user.username}</p>
            <p className="text-sm text-neutral-500">{user.email}</p>
          </div>
        </div>
      )}

      {/* Profile photo (Profile Pictures feature) */}
      <ProfilePhotoSection />

      {/* Wallet & Stats */}
      <div className="bg-white px-6 py-2 mb-3">
        <Link to="/wallet" className="flex items-center justify-between py-2.5 border-b border-neutral-100">
          <span className="text-sm text-neutral-700">🪙 {t('wallet.title')}</span>
          <span className="text-neutral-400">→</span>
        </Link>
        {statsAccess.accessible && (
          <Link to="/stats" className="flex items-center justify-between py-2.5">
            <span className="text-sm text-neutral-700">📊 {t('profile.actions.stats')}</span>
            <span className="text-neutral-400">→</span>
          </Link>
        )}
      </div>

      {/* Privacy, Security & Help (BUG-CAP-07) */}
      <div className="bg-white px-6 py-2 mb-3">
        <Link to="/settings/privacy" className="flex items-center justify-between py-2.5 border-b border-neutral-100">
          <span className="text-sm text-neutral-700">🔒 {t('settings.privacy.title', 'Privacy')}</span>
          <span className="text-neutral-400">→</span>
        </Link>
        <Link to="/settings/security" className="flex items-center justify-between py-2.5 border-b border-neutral-100">
          <span className="text-sm text-neutral-700">🛡️ {t('settings.security.title', 'Security')}</span>
          <span className="text-neutral-400">→</span>
        </Link>
        <Link to="/help" className="flex items-center justify-between py-2.5">
          <span className="text-sm text-neutral-700">❓ {t('help.title', 'Help & Support')}</span>
          <span className="text-neutral-400">→</span>
        </Link>
      </div>

      {/* Language */}
      <div className="bg-white px-6 py-4 mb-3">
        <h3 className="text-sm font-semibold text-neutral-700 mb-3">{t('android.settings.language')}</h3>
        <div className="space-y-2">
          {SUPPORTED_LOCALES.map((locale) => (
            <button
              key={locale}
              onClick={() => handleLanguageChange(locale)}
              className={`w-full flex items-center justify-between py-2 px-3 rounded-lg ${
                i18n.language === locale
                  ? 'bg-primary-50 text-primary-600'
                  : 'text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              <span className="text-sm">{LOCALE_LABELS[locale as SupportedLocale]}</span>
              {i18n.language === locale && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tweets — personal max Tweet length */}
      {tweetsConfig.enabled && <TweetLengthSection />}

      {/* Gender */}
      <GenderSection />

      {/* Restore Purchases (ZB-AND-09) */}
      <RestorePurchasesSection />

      {/* Data & Account (BUG-CAP-07) */}
      <DataAndAccountSection />

      {/* App version */}
      <div className="bg-white px-6 py-4 mb-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-700">{t('android.settings.version')}</span>
          <span className="text-sm text-neutral-400">{appVersion}</span>
        </div>
      </div>

      {/* Logout */}
      <div className="px-6 py-4">
        <button
          onClick={handleLogout}
          className="w-full py-3 border border-danger-300 text-danger-600 font-semibold rounded-lg"
        >
          {t('android.settings.logout')}
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});
