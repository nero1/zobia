/**
 * apps/android/src/routes/onboarding.tsx
 *
 * Post-OAuth onboarding — fixes ZB-AND-03. Android had no onboarding route at
 * all: a brand-new Google/Telegram signup landed straight on /home with an
 * auto-generated username, no avatar/city, no welcome XP/coins, and any
 * referral code captured via lib/deeplinks/referral.ts (ZB-AND-02) was never
 * redeemed. __root.tsx's OAuth callback now routes here instead of /home
 * when the mobile-token response's `onboardingCompleted` is false.
 *
 * This is a single-page condensed version of the web wizard
 * (apps/web/app/onboarding/page.tsx's Step 1 field set) rather than a full
 * multi-step clone — same POST /api/onboarding/complete contract, same
 * validation rules, no server-side changes needed. The Vibe Quiz / Guild
 * Discovery / First Contact steps stay web/PWA-only, consistent with this
 * app's existing convention of not reimplementing every web step natively
 * (see routes/games/index.tsx's header comment for the same convention).
 */

import { useEffect, useRef, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';
import { getPendingReferralCode, clearPendingReferralCode } from '@/lib/deeplinks/referral';

const AVATAR_OPTIONS = [
  '😎', '🔥', '👑', '💎', '🦁', '🐯', '⚡', '🚀', '🎯', '💪',
  '🌟', '🎭', '🏆', '🌊', '🦅', '🌙', '☀️', '🎸',
];

const CURRENT_YEAR = new Date().getFullYear();

interface ManifestPublic {
  captchaProvider: 'recaptcha' | 'turnstile' | 'none';
  recaptchaSiteKey?: string;
  turnstileSiteKey?: string;
  minimumAge: number;
}

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
    turnstile?: {
      render: (container: string | HTMLElement, opts: object) => string;
      getResponse: (widgetId: string) => string | undefined;
    };
  }
}

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setAuth, token, user } = useAuth();

  const [manifest, setManifest] = useState<ManifestPublic | null>(null);
  const [avatarEmoji, setAvatarEmoji] = useState(AVATAR_OPTIONS[0]);
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle');
  const [displayName, setDisplayName] = useState('');
  const [city, setCity] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const turnstileWidgetId = useRef<string | null>(null);
  const captchaContainerRef = useRef<HTMLDivElement>(null);

  // Load manifest (captcha config + minimum age) and any pending referral code.
  useEffect(() => {
    apiClient.get<ManifestPublic>('/manifest')
      .then(({ data }) => setManifest(data))
      .catch(() => setManifest({ captchaProvider: 'none', minimumAge: 13 }));
    getPendingReferralCode().then((code) => { if (code) setReferralCode(code); });
  }, []);

  // Load + render the CAPTCHA widget once manifest resolves.
  useEffect(() => {
    if (!manifest) return;
    if (manifest.captchaProvider === 'recaptcha' && manifest.recaptchaSiteKey) {
      void loadScriptOnce(`https://www.google.com/recaptcha/api.js?render=${manifest.recaptchaSiteKey}`);
    } else if (manifest.captchaProvider === 'turnstile' && manifest.turnstileSiteKey) {
      loadScriptOnce('https://challenges.cloudflare.com/turnstile/v0/api.js').then(() => {
        if (captchaContainerRef.current && !turnstileWidgetId.current && window.turnstile) {
          turnstileWidgetId.current = window.turnstile.render(captchaContainerRef.current, {
            sitekey: manifest.turnstileSiteKey,
          });
        }
      }).catch(() => {});
    }
  }, [manifest]);

  // Debounced username availability check.
  useEffect(() => {
    if (username.length < 3) { setUsernameStatus('idle'); return; }
    if (!/^[a-z0-9_-]{3,30}$/.test(username)) { setUsernameStatus('invalid'); return; }
    setUsernameStatus('checking');
    const timeout = setTimeout(() => {
      apiClient.get<{ available: boolean }>(`/onboarding/check-username?username=${encodeURIComponent(username)}`)
        .then(({ data }) => setUsernameStatus(data.available ? 'ok' : 'taken'))
        .catch(() => setUsernameStatus('idle'));
    }, 500);
    return () => clearTimeout(timeout);
  }, [username]);

  async function getCaptchaToken(): Promise<string | null> {
    if (!manifest || manifest.captchaProvider === 'none') return null;
    if (manifest.captchaProvider === 'recaptcha' && manifest.recaptchaSiteKey) {
      const recaptchaPromise = new Promise<string | null>((resolve) => {
        // ZSB-20 fix: if window.grecaptcha is still undefined (the script tag
        // is still loading), the optional-chaining call used to short-circuit
        // the whole `.ready(...)` call and `resolve` was never invoked — the
        // promise never settled, so `handleSubmit`'s `await getCaptchaToken()`
        // hung forever with the submit button stuck on "Submitting…". Guard
        // explicitly and always resolve.
        if (!window.grecaptcha) {
          resolve(null);
          return;
        }
        window.grecaptcha.ready(async () => {
          try {
            resolve(await window.grecaptcha!.execute(manifest.recaptchaSiteKey!, { action: 'onboarding' }));
          } catch {
            resolve(null);
          }
        });
      });
      // Belt-and-suspenders: even a script that *is* present but hangs inside
      // `.ready()`/`.execute()` degrades to "no captcha token" (which the
      // server rejects with a normal, recoverable error) instead of hanging
      // the UI indefinitely.
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
      return Promise.race([recaptchaPromise, timeoutPromise]);
    }
    if (manifest.captchaProvider === 'turnstile' && turnstileWidgetId.current) {
      return window.turnstile?.getResponse(turnstileWidgetId.current) ?? null;
    }
    return null;
  }

  function validate(): boolean {
    const minAge = manifest?.minimumAge ?? 13;
    const errs: Record<string, string> = {};
    if (usernameStatus !== 'ok') errs.username = t('onboarding.step1.usernameError');
    if (!displayName.trim()) errs.displayName = t('onboarding.step1.displayNameError');
    const yr = parseInt(birthYear, 10);
    if (!birthYear) {
      errs.birthYear = t('onboarding.step1.birthYearError');
    } else if (isNaN(yr) || yr < 1900 || yr > CURRENT_YEAR) {
      errs.birthYear = t('onboarding.step1.birthYearInvalid', { year: CURRENT_YEAR });
    } else if (CURRENT_YEAR - yr < minAge) {
      errs.birthYear = t('onboarding.step1.ageError', { age: minAge });
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSubmitting(true);
    setError(null);
    try {
      const captchaToken = await getCaptchaToken();
      const { data } = await apiClient.post<{ xpAwarded?: number; referralCode?: string }>('/onboarding/complete', {
        username: username.toLowerCase(),
        display_name: displayName.trim(),
        avatar_emoji: avatarEmoji,
        city: city.trim() || undefined,
        birth_year: parseInt(birthYear, 10),
        referral_code: referralCode.trim() || undefined,
        captcha_token: captchaToken ?? undefined,
      });
      void data;
      await clearPendingReferralCode();
      // Reflect the new username/avatar locally so Profile/Settings don't show
      // stale auto-generated values until the next background /users/me sync.
      if (token && user) {
        await setAuth(token, { ...user, username: username.toLowerCase() });
      }
      navigate({ to: '/home', replace: true });
    } catch (err) {
      const code = (err as { response?: { data?: { error?: { code?: string; message?: string; params?: { minAge?: number } } } } })
        ?.response?.data?.error;
      if (code?.code === 'AGE_REQUIREMENT_NOT_MET') {
        setError(t('onboarding.error.ageTooYoung', { age: code.params?.minAge ?? manifest?.minimumAge ?? 13 }));
      } else if (code?.code === 'CAPTCHA_FAILED' || code?.code === 'CAPTCHA_REQUIRED') {
        setError(t('onboarding.error.captchaFailed'));
      } else if (code?.code === 'USERNAME_TAKEN') {
        setError(t('onboarding.error.usernameTaken'));
        setUsernameStatus('taken');
      } else {
        setError(code?.message ?? t('onboarding.error.generic'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const usernameIndicator = {
    idle: null,
    checking: <span className="text-xs text-neutral-400">{t('onboarding.step1.usernameChecking')}</span>,
    ok: <span className="text-xs text-green-600">{t('onboarding.step1.usernameAvailable')}</span>,
    taken: <span className="text-xs text-red-500">{t('onboarding.step1.usernameTaken')}</span>,
    invalid: <span className="text-xs text-red-500">{t('onboarding.step1.usernameInvalid')}</span>,
  }[usernameStatus];

  return (
    <div className="min-h-full bg-white px-6 py-10">
      <div className="mx-auto max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">{t('onboarding.step1.title')}</h1>
          <p className="mt-1 text-sm text-neutral-500">{t('onboarding.step1.subtitle')}</p>
        </div>

        {error && (
          <div role="alert" className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">
            {error}
          </div>
        )}

        {/* Avatar picker */}
        <div>
          <label className="mb-2 block text-sm font-semibold text-neutral-700">{t('onboarding.step1.avatarLabel')}</label>
          <div className="flex flex-wrap gap-2">
            {AVATAR_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setAvatarEmoji(emoji)}
                className={`h-10 w-10 rounded-full text-xl transition-all ${avatarEmoji === emoji ? 'ring-2 ring-primary-500 ring-offset-2 scale-110' : ''}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Username */}
        <div>
          <label className="mb-1 block text-sm font-semibold text-neutral-700">{t('onboarding.step1.usernameLabel')}</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            placeholder={t('onboarding.step1.usernamePlaceholder')}
            maxLength={30}
            autoComplete="off"
            className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none"
          />
          <div className="mt-1">
            {fieldErrors.username ? <p role="alert" className="text-xs text-red-600">{fieldErrors.username}</p> : usernameIndicator}
          </div>
        </div>

        {/* Display name */}
        <div>
          <label className="mb-1 block text-sm font-semibold text-neutral-700">{t('onboarding.step1.displayNameLabel')}</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('onboarding.step1.displayNamePlaceholder')}
            maxLength={50}
            className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none"
          />
          {fieldErrors.displayName && <p role="alert" className="mt-1 text-xs text-red-600">{fieldErrors.displayName}</p>}
        </div>

        {/* City */}
        <div>
          <label className="mb-1 block text-sm font-semibold text-neutral-700">{t('onboarding.step1.cityLabel')}</label>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={t('onboarding.step1.citySearchPlaceholder')}
            className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none"
          />
        </div>

        {/* Birth year */}
        <div>
          <label className="mb-1 block text-sm font-semibold text-neutral-700">{t('onboarding.step1.birthYearLabel')}</label>
          <input
            type="number"
            inputMode="numeric"
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value)}
            placeholder={`e.g. ${CURRENT_YEAR - 20}`}
            min={1900}
            max={CURRENT_YEAR}
            className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none"
          />
          {fieldErrors.birthYear
            ? <p role="alert" className="mt-1 text-xs text-red-600">{fieldErrors.birthYear}</p>
            : <p className="mt-1 text-xs text-neutral-400">{t('onboarding.step1.birthYearHint', { age: manifest?.minimumAge ?? 13 })}</p>}
        </div>

        {/* Referral code — prefilled from a captured deep link (ZB-AND-02), editable */}
        <div>
          <label className="mb-1 block text-sm font-semibold text-neutral-700">{t('onboarding.referralCode.label')}</label>
          <input
            type="text"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value)}
            placeholder={t('onboarding.referralCode.placeholder')}
            maxLength={20}
            className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-900 focus:border-primary-500 focus:outline-none"
          />
        </div>

        {manifest?.captchaProvider === 'turnstile' && <div ref={captchaContainerRef} />}

        <button
          type="button"
          disabled={submitting}
          onClick={() => void handleSubmit()}
          className="w-full rounded-xl bg-primary-600 py-3.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {submitting ? t('onboarding.step2.submitting') : t('onboarding.step2.submitBtn')}
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
});
