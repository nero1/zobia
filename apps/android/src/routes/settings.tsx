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
import { useFeatureFlags, useFeatureModVisibility, resolveFeatureAccess, usePhoneVerificationRequired } from '@/lib/hooks/useManifest';
import { useTweetsConfig } from '@/lib/hooks/useTweetsConfig';
import { useTweetLengthPolicy } from '@/lib/hooks/useTweetLengthPolicy';
import { AvatarCropModal } from '@/components/profile/AvatarCropModal';
import { useTheme } from '@/lib/theme/ThemeProvider';
import type { ThemePreference } from '@/lib/theme/store';

// ZB-AND-09 fix: restorePurchases() was fully implemented in
// lib/payments/googlePlay.ts but had no UI entry point anywhere in the app —
// a user who reinstalled or switched devices had no way to recover
// entitlements without contacting support.
// Theme toggle — mirrors apps/web's settings page (next-themes light/dark/
// system picker) via lib/theme, a client-only preference persisted with
// Capacitor Preferences. See lib/theme/store.ts for why this needs no API
// call: web itself keeps UI theme out of the server-synced chat-theme field.
const THEME_OPTIONS: { value: ThemePreference; emoji: string }[] = [
  { value: 'light', emoji: '☀️' },
  { value: 'dark', emoji: '🌙' },
  { value: 'system', emoji: '💻' },
];

function ThemeSection() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <div className="bg-white dark:bg-neutral-800 px-6 py-4 mb-3">
      <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-3">{t('settings.theme', 'Theme')}</h3>
      <div className="flex gap-2">
        {THEME_OPTIONS.map(({ value, emoji }) => (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            className={`flex-1 rounded-lg py-2.5 text-sm font-semibold capitalize transition-colors ${
              theme === value ? 'bg-primary-600 text-white' : 'border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300'
            }`}
          >
            {emoji} {t(`settings.theme.${value}`, value)}
          </button>
        ))}
      </div>
    </div>
  );
}

function RestorePurchasesSection() {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'restoring' | 'success' | 'error'>('idle');

  async function handleRestore() {
    setState('restoring');
    const result = await restorePurchases();
    setState(result.error ? 'error' : 'success');
  }

  return (
    <div className="bg-white dark:bg-neutral-800 px-6 py-4 mb-3">
      <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-1">{t('settings.restorePurchases.title')}</h3>
      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">{t('settings.restorePurchases.desc')}</p>
      <button
        onClick={() => void handleRestore()}
        disabled={state === 'restoring'}
        className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
      >
        {state === 'restoring' ? t('settings.restorePurchases.restoring') : t('settings.restorePurchases.button')}
      </button>
      {state === 'success' && <p className="mt-2 text-xs text-green-600 dark:text-green-300">{t('settings.restorePurchases.success')}</p>}
      {state === 'error' && <p className="mt-2 text-xs text-danger-600 dark:text-danger-300">{t('settings.restorePurchases.error')}</p>}
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
    <div className="bg-white dark:bg-neutral-800 px-6 py-4 mb-3">
      <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-3">{t('settings.gender.label', 'Gender')}</h3>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => void save(opt.value)}
            disabled={saving}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${
              gender === opt.value
                ? 'bg-primary-600 text-white'
                : 'border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function UsernameSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [currentUsername, setCurrentUsername] = useState<string | null>(user?.username ?? null);
  const [eligibility, setEligibility] = useState<{
    eligible: boolean;
    reason: string | null;
    costCredits: number;
    costStars: number;
  } | null>(null);
  const [step, setStep] = useState<'idle' | 'pick' | 'confirm'>('idle');
  const [candidate, setCandidate] = useState('');
  const [availability, setAvailability] = useState<{ available: boolean; reason?: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [currency, setCurrency] = useState<'credits' | 'stars'>('credits');
  const [redirectEnabled, setRedirectEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<{ data: { eligible: boolean; reason: string | null; costCredits: number; costStars: number } }>('/users/me/username')
      .then(({ data }) => setEligibility(data.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (step !== 'pick' || candidate.trim().length < 3) {
      setAvailability(null);
      return;
    }
    setChecking(true);
    const handle = setTimeout(() => {
      apiClient
        .get<{ data: { available: boolean; reason?: string } }>(
          `/users/me/username/availability?username=${encodeURIComponent(candidate.trim())}`
        )
        .then(({ data }) => setAvailability(data.data))
        .catch(() => setAvailability({ available: false, reason: t('settings.username.checkFailed', "Couldn't check availability") }))
        .finally(() => setChecking(false));
    }, 400);
    return () => clearTimeout(handle);
  }, [candidate, step, t]);

  const isFree = (eligibility?.costCredits ?? 0) <= 0 && (eligibility?.costStars ?? 0) <= 0;

  async function confirmChange() {
    setSaving(true);
    setError(null);
    try {
      const { data } = await apiClient.post<{ data: { newUsername: string } }>('/users/me/username', {
        username: candidate.trim().toLowerCase(),
        currency: isFree ? undefined : currency,
        redirectEnabled,
      });
      setCurrentUsername(data.data.newUsername);
      setSuccess(t('settings.username.changed', 'Username changed!'));
      setStep('idle');
      setCandidate('');
    } catch {
      setError(t('settings.username.changeFailed', "Couldn't change username"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white dark:bg-neutral-800 px-6 py-4 mb-3">
      <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-1">{t('settings.username.title', 'Username')}</h3>
      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">
        {t('settings.username.current', 'Current username')}: @{currentUsername}
      </p>

      {eligibility && !eligibility.eligible && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
          {eligibility.reason ?? t('settings.username.notEligible', "You're not eligible to change your username right now.")}
        </p>
      )}
      {error && <p className="text-xs text-danger-600 dark:text-danger-300 mb-2">{error}</p>}
      {success && <p className="text-xs text-green-600 dark:text-green-300 mb-2">{success}</p>}

      {step === 'idle' && (
        <button
          onClick={() => { setStep('pick'); setSuccess(null); }}
          disabled={!eligibility?.eligible}
          className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
        >
          {t('settings.username.change', 'Change username')}
        </button>
      )}

      {step === 'pick' && (
        <div className="space-y-3">
          <input
            value={candidate}
            onChange={(e) => setCandidate(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
            placeholder={t('settings.username.placeholder', 'new_username')}
            maxLength={30}
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-2 text-sm"
          />
          {checking && <p className="text-xs text-neutral-400 dark:text-neutral-500">{t('settings.username.checking', 'Checking availability…')}</p>}
          {!checking && availability && (
            <p className={`text-xs ${availability.available ? 'text-green-600 dark:text-green-300' : 'text-danger-600 dark:text-danger-300'}`}>
              {availability.available
                ? t('settings.username.available', 'Available!')
                : availability.reason ?? t('settings.username.unavailable', 'Not available')}
            </p>
          )}

          <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
            <input type="checkbox" checked={redirectEnabled} onChange={(e) => setRedirectEnabled(e.target.checked)} />
            {t('settings.username.redirectTitle', 'Redirect my old username')}
          </label>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {redirectEnabled
              ? t('settings.username.redirectOnHint', 'Visits to your old username will always redirect here.')
              : t('settings.username.redirectOffHint', 'Your old username will be held for 1 year, then released — nobody can claim it during that year.')}
          </p>

          {!isFree && eligibility && (
            <div className="flex gap-2">
              {eligibility.costCredits > 0 && (
                <button
                  onClick={() => setCurrency('credits')}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${currency === 'credits' ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-400'}`}
                >
                  {t('settings.username.costCredits', '{{amount}} Credits', { amount: eligibility.costCredits })}
                </button>
              )}
              {eligibility.costStars > 0 && (
                <button
                  onClick={() => setCurrency('stars')}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${currency === 'stars' ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'border-neutral-300 dark:border-neutral-600 text-neutral-600 dark:text-neutral-400'}`}
                >
                  {t('settings.username.costStars', '{{amount}} Stars', { amount: eligibility.costStars })}
                </button>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => { setStep('idle'); setCandidate(''); setAvailability(null); }}
              className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-xs font-semibold"
            >
              {t('action.cancel', 'Cancel')}
            </button>
            <button
              onClick={() => setStep('confirm')}
              disabled={!availability?.available}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {t('common.continue', 'Continue')}
            </button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-2 rounded-lg border border-neutral-200 dark:border-neutral-700 p-3 mt-2">
          <p className="text-xs text-neutral-700 dark:text-neutral-300">
            {t('settings.username.confirmBody', 'Change @{{old}} to @{{new}}?', { old: currentUsername, new: candidate })}
          </p>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {isFree
              ? t('settings.username.confirmFree', 'This is free.')
              : t('settings.username.confirmCost', 'Cost: {{amount}} {{currency}}.', {
                  amount: currency === 'credits' ? eligibility?.costCredits : eligibility?.costStars,
                  currency: currency === 'credits' ? t('common.credits', 'Credits') : t('common.stars', 'Stars'),
                })}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setStep('pick')} className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-xs font-semibold">
              {t('common.back', 'Back')}
            </button>
            <button
              onClick={() => void confirmChange()}
              disabled={saving}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {saving ? t('common.saving', 'Saving…') : t('common.confirm', 'Confirm')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type PhoneStep = 'idle' | 'editing' | 'awaiting-code';

/**
 * Phone number capture — mirrors apps/web's settings page PhoneNumberSection.
 * Self-attested by default (no SMS involved); the admin can turn on OTP
 * confirmation at /gate44/config (x_manifest phone_verification_required),
 * in which case saving moves to an "awaiting-code" step instead of saving
 * immediately. Powers the "find your contacts on Zobia" cross-reference
 * feature (apps/web/app/api/users/contacts/cross-reference/route.ts).
 */
function PhoneSection() {
  const { t } = useTranslation();
  const requiresVerification = usePhoneVerificationRequired();
  const [currentPhone, setCurrentPhone] = useState<string | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null);
  const [step, setStep] = useState<PhoneStep>('idle');
  const [inputValue, setInputValue] = useState('');
  const [codeValue, setCodeValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<{ user?: { phone_number?: string | null; phone_verified_at?: string | null } }>('/users/me')
      .then(({ data }) => {
        setCurrentPhone(data.user?.phone_number ?? null);
        setVerifiedAt(data.user?.phone_verified_at ?? null);
      })
      .catch(() => {});
  }, []);

  async function submitNumber() {
    setSaving(true);
    setError(null);
    try {
      const { data } = await apiClient.post<{ requiresVerification: boolean }>('/users/phone/start', {
        phoneNumber: inputValue.trim(),
      });
      if (data.requiresVerification) {
        setStep('awaiting-code');
        setSuccess(t('settings.phone.codeSent', 'Code sent! Check your phone.'));
      } else {
        setCurrentPhone(inputValue.trim());
        setVerifiedAt(null);
        setStep('idle');
        setInputValue('');
        setSuccess(t('settings.phone.saved', 'Phone number saved.'));
      }
    } catch {
      setError(t('settings.phone.saveFailed', "Couldn't save phone number"));
    } finally {
      setSaving(false);
    }
  }

  async function submitCode() {
    setVerifying(true);
    setError(null);
    try {
      const { data } = await apiClient.post<{ phoneNumber: string }>('/users/phone/verify', {
        code: codeValue.trim(),
      });
      setCurrentPhone(data.phoneNumber);
      setVerifiedAt(new Date().toISOString());
      setStep('idle');
      setInputValue('');
      setCodeValue('');
      setSuccess(t('settings.phone.verified', 'Phone number verified!'));
    } catch {
      setError(t('settings.phone.verifyFailed', "Couldn't verify code"));
    } finally {
      setVerifying(false);
    }
  }

  async function removeNumber() {
    setSaving(true);
    setError(null);
    try {
      await apiClient.delete('/users/phone');
      setCurrentPhone(null);
      setVerifiedAt(null);
      setSuccess(t('settings.phone.removed', 'Phone number removed.'));
    } catch {
      setError(t('settings.phone.removeFailed', "Couldn't remove phone number"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white dark:bg-neutral-800 px-6 py-4 mb-3">
      <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-1">{t('settings.phone.title', 'Phone Number')}</h3>
      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3">
        {t('settings.phone.hint', 'Let people who already have your number as a contact find you on Zobia.')}
      </p>

      {error && <p className="text-xs text-danger-600 dark:text-danger-300 mb-2">{error}</p>}
      {success && <p className="text-xs text-green-600 dark:text-green-300 mb-2">{success}</p>}

      {step === 'idle' && (
        <>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
            {t('settings.phone.current', 'Current number')}: {currentPhone ?? t('settings.phone.notSet', 'Not set')}
            {currentPhone && requiresVerification && (
              <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${verifiedAt ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-700'}`}>
                {verifiedAt ? t('settings.phone.verifiedBadge', 'Verified') : t('settings.phone.unverifiedBadge', 'Unverified')}
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { setStep('editing'); setInputValue(currentPhone ?? ''); setSuccess(null); setError(null); }}
              className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-xs font-semibold"
            >
              {currentPhone ? t('settings.phone.change', 'Change number') : t('settings.phone.add', 'Add number')}
            </button>
            {currentPhone && (
              <button
                onClick={() => void removeNumber()}
                disabled={saving}
                className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
              >
                {t('settings.phone.remove', 'Remove')}
              </button>
            )}
          </div>
        </>
      )}

      {step === 'editing' && (
        <div className="space-y-3">
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="+2348012345678"
            maxLength={20}
            inputMode="tel"
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-2 text-sm"
          />
          {requiresVerification && (
            <p className="text-xs text-neutral-400 dark:text-neutral-500">{t('settings.phone.otpHint', "We'll text you a code to confirm this number.")}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => { setStep('idle'); setInputValue(''); }}
              className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-xs font-semibold"
            >
              {t('action.cancel', 'Cancel')}
            </button>
            <button
              onClick={() => void submitNumber()}
              disabled={saving || inputValue.trim().length < 8}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
            </button>
          </div>
        </div>
      )}

      {step === 'awaiting-code' && (
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            {t('settings.phone.enterCode', 'Enter the 6-digit code we sent to {{number}}', { number: inputValue.trim() })}
          </label>
          <input
            value={codeValue}
            onChange={(e) => setCodeValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            maxLength={6}
            inputMode="numeric"
            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-2 text-center text-lg tracking-widest"
          />
          <div className="flex items-center justify-between">
            <button
              onClick={() => void submitNumber()}
              disabled={saving}
              className="text-xs font-semibold text-primary-600 dark:text-primary-400 disabled:opacity-60"
            >
              {t('settings.phone.resend', 'Resend code')}
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => { setStep('idle'); setCodeValue(''); }}
                className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-xs font-semibold"
              >
                {t('action.cancel', 'Cancel')}
              </button>
              <button
                onClick={() => void submitCode()}
                disabled={verifying || codeValue.length !== 6}
                className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {verifying ? t('common.verifying', 'Verifying…') : t('common.verify', 'Verify')}
              </button>
            </div>
          </div>
        </div>
      )}
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
    <div className="bg-white dark:bg-neutral-800 px-6 py-4 mb-3">
      <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-3">{t('settings.dataAccount.title', 'Data & Account')}</h3>

      <div className="mb-4">
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
          {t('settings.dataAccount.exportDesc', 'Download a copy of your account data.')}
        </p>
        <button
          onClick={() => void handleExport()}
          disabled={exporting}
          className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
        >
          {exporting ? t('settings.dataAccount.exporting', 'Preparing…') : t('settings.dataAccount.export', 'Request my data')}
        </button>
        {exportedJson && (
          <div className="mt-2">
            <pre className="max-h-40 overflow-auto rounded-lg bg-neutral-100 dark:bg-neutral-800 p-2 text-[10px] text-neutral-700 dark:text-neutral-300 select-all">{exportedJson}</pre>
            <button onClick={() => void handleCopy()} className="mt-1 text-xs font-semibold text-primary-600 dark:text-primary-300">
              {copyState === 'copied' ? t('settings.dataAccount.copied', 'Copied!') : t('settings.dataAccount.copy', 'Copy to clipboard')}
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-neutral-100 dark:border-neutral-800 pt-4">
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">{t('settings.dataAccount.deleteDesc', 'Permanently delete your account and all associated data.')}</p>
        {!showDeleteConfirm ? (
          <button onClick={() => setShowDeleteConfirm(true)} className="rounded-lg border border-danger-300 px-3 py-1.5 text-xs font-semibold text-danger-600 dark:text-danger-300">
            {t('settings.dataAccount.delete', 'Delete account')}
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              {t('settings.dataAccount.deleteConfirmHint', 'Type DELETE to confirm — this cannot be undone.')}
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-2 text-sm"
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
                className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-xs font-semibold"
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
    <div className="bg-white dark:bg-neutral-800 px-6 py-4 mb-3">
      <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-1">{t('tweets.title')}</h3>
      <label className="mb-1 mt-2 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
        {t('settings.tweetMaxLength.label')}
      </label>
      <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
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
          className="w-28 rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm disabled:opacity-40"
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
    <div className="bg-white dark:bg-neutral-800 px-6 py-4 mb-3">
      <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-3">{t('profile.avatar.sectionLabel')}</h3>
      <div className="flex items-center gap-4">
        {data?.avatar_url ? (
          <img src={data.avatar_url} alt="" className="w-16 h-16 rounded-full object-cover" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center text-2xl">
            {data?.avatar_emoji ?? '👤'}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-xs font-semibold"
            >
              {t('profile.avatar.uploadPhoto')}
            </button>
            <button
              onClick={() => setShowDefaultIconPicker((v) => !v)}
              className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-xs font-semibold"
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

      {toast && <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">{toast}</p>}

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
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-800">
      {/* Current user */}
      {user && (
        <div className="bg-white dark:bg-neutral-800 px-6 py-4 mb-3 flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary-100 dark:bg-primary-900/40 flex items-center justify-center text-2xl">
            👤
          </div>
          <div>
            <p className="font-semibold text-neutral-900 dark:text-neutral-100">{user.username}</p>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">{user.email}</p>
          </div>
        </div>
      )}

      {/* Profile photo (Profile Pictures feature) */}
      <ProfilePhotoSection />

      {/* Wallet & Stats */}
      <div className="bg-white dark:bg-neutral-800 px-6 py-2 mb-3">
        <Link to="/wallet" className="flex items-center justify-between py-2.5 border-b border-neutral-100 dark:border-neutral-800">
          <span className="text-sm text-neutral-700 dark:text-neutral-300">🪙 {t('wallet.title')}</span>
          <span className="text-neutral-400 dark:text-neutral-500">→</span>
        </Link>
        {statsAccess.accessible && (
          <Link to="/stats" className="flex items-center justify-between py-2.5">
            <span className="text-sm text-neutral-700 dark:text-neutral-300">📊 {t('profile.actions.stats')}</span>
            <span className="text-neutral-400 dark:text-neutral-500">→</span>
          </Link>
        )}
      </div>

      {/* Privacy, Security, Notifications, Subscription, Business & Help (BUG-CAP-07) */}
      <div className="bg-white dark:bg-neutral-800 px-6 py-2 mb-3">
        <Link to="/settings/privacy" className="flex items-center justify-between py-2.5 border-b border-neutral-100 dark:border-neutral-800">
          <span className="text-sm text-neutral-700 dark:text-neutral-300">🔒 {t('settings.privacy.title', 'Privacy')}</span>
          <span className="text-neutral-400 dark:text-neutral-500">→</span>
        </Link>
        <Link to="/settings/security" className="flex items-center justify-between py-2.5 border-b border-neutral-100 dark:border-neutral-800">
          <span className="text-sm text-neutral-700 dark:text-neutral-300">🛡️ {t('settings.security.title', 'Security')}</span>
          <span className="text-neutral-400 dark:text-neutral-500">→</span>
        </Link>
        <Link to="/settings/notifications" className="flex items-center justify-between py-2.5 border-b border-neutral-100 dark:border-neutral-800">
          <span className="text-sm text-neutral-700 dark:text-neutral-300">🔔 {t('settings.notifications', 'Notifications')}</span>
          <span className="text-neutral-400 dark:text-neutral-500">→</span>
        </Link>
        <Link to="/settings/subscription" className="flex items-center justify-between py-2.5 border-b border-neutral-100 dark:border-neutral-800">
          <span className="text-sm text-neutral-700 dark:text-neutral-300">💳 {t('settings.subscriptionBilling', 'Subscription & Billing')}</span>
          <span className="text-neutral-400 dark:text-neutral-500">→</span>
        </Link>
        <Link to="/settings/business" className="flex items-center justify-between py-2.5 border-b border-neutral-100 dark:border-neutral-800">
          <span className="text-sm text-neutral-700 dark:text-neutral-300">🏢 {t('settings.business', 'Business Account')}</span>
          <span className="text-neutral-400 dark:text-neutral-500">→</span>
        </Link>
        <Link to="/help" className="flex items-center justify-between py-2.5">
          <span className="text-sm text-neutral-700 dark:text-neutral-300">❓ {t('help.title', 'Help & Support')}</span>
          <span className="text-neutral-400 dark:text-neutral-500">→</span>
        </Link>
      </div>

      {/* Theme */}
      <ThemeSection />

      {/* Language */}
      <div className="bg-white dark:bg-neutral-800 px-6 py-4 mb-3">
        <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-3">{t('android.settings.language')}</h3>
        <div className="space-y-2">
          {SUPPORTED_LOCALES.map((locale) => (
            <button
              key={locale}
              onClick={() => handleLanguageChange(locale)}
              className={`w-full flex items-center justify-between py-2 px-3 rounded-lg ${
                i18n.language === locale
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-300'
                  : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800'
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

      {/* Change username */}
      <UsernameSection />

      {/* Phone number (contacts cross-reference capture) */}
      <PhoneSection />

      {/* Restore Purchases (ZB-AND-09) */}
      <RestorePurchasesSection />

      {/* Data & Account (BUG-CAP-07) */}
      <DataAndAccountSection />

      {/* App version */}
      <div className="bg-white dark:bg-neutral-800 px-6 py-4 mb-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-700 dark:text-neutral-300">{t('android.settings.version')}</span>
          <span className="text-sm text-neutral-400 dark:text-neutral-500">{appVersion}</span>
        </div>
      </div>

      {/* Logout */}
      <div className="px-6 py-4">
        <button
          onClick={handleLogout}
          className="w-full py-3 border border-danger-300 text-danger-600 dark:text-danger-300 font-semibold rounded-lg"
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
