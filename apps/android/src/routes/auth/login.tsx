/**
 * apps/android/src/routes/auth/login.tsx
 *
 * Login screen — OAuth only (mirrors web canonical).
 * Google: opens API OAuth init directly in Custom Tab so browser commits
 *   the CSRF cookie before the Google redirect (same pattern as Expo).
 * Telegram: opens the hosted Telegram-mobile widget page; after the user
 *   authorises, the server redirects to the callback deep link with
 *   ?code=..., which the appUrlOpen listener in __root.tsx picks up.
 *
 * BUG-CAP-04 fix: the callback now targets the verified Android App Link
 * (`https://<web-origin>/auth/callback`, see AndroidManifest.xml's `zobia.org`
 * intent-filter and BUG-CAP-03) instead of the `zobia://` custom scheme.
 * Android App Links are exclusive to the one app that owns the domain, unlike
 * a custom scheme which any installed app can also register, so this closes
 * the OAuth-code-interception window a custom-scheme-only redirect left open.
 * `zobia://auth/callback` is still accepted by __root.tsx as a fallback for
 * devices/browsers where App Links verification hasn't succeeded.
 */

import { useState, useEffect } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Browser } from '@capacitor/browser';
import { env } from '@/lib/env';
import { OAUTH_CALLBACK_LINK } from '@/lib/deeplinks/routes';
import { beginOAuthAttempt, endOAuthAttempt, onOAuthEnd } from '@/lib/auth/preAuth';

const CALLBACK_DEEP_LINK = OAUTH_CALLBACK_LINK;

function LoginPage() {
  const { t } = useTranslation();
  const { reason } = Route.useSearch();

  const [googleLoading, setGoogleLoading] = useState(false);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ZSB-22 fix: the loading spinner used to clear as soon as `Browser.open`
  // resolved — the instant the Custom Tab opened, not when the OAuth flow
  // actually finished — giving almost no protection against double-tapping
  // the button mid-flow. It now stays set until __root.tsx's `appUrlOpen`
  // handler (success/failure) or the foreground-resume abandon fallback
  // clears the shared `_oauthInProgress` flag (see lib/auth/preAuth.ts).
  useEffect(() => {
    return onOAuthEnd(() => {
      setGoogleLoading(false);
      setTelegramLoading(false);
    });
  }, []);

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setError(null);
    beginOAuthAttempt();
    try {
      // Open the Google OAuth init endpoint directly in the Custom Tab.
      // The browser stores the Set-Cookie headers (CSRF + mobile-redirect) so
      // they are present when the /api/auth/google/callback request comes back.
      // Passing the redirect URL tells the callback where to send the exchange code.
      await Browser.open({
        url: `${env.VITE_API_BASE_URL}/api/auth/google?redirect=${encodeURIComponent(CALLBACK_DEEP_LINK)}`,
        presentationStyle: 'popover',
      });
    } catch (err) {
      console.error('[auth] Browser.open (Google) failed:', err);
      setError(t('auth.error.oauthFailed'));
      // The tab never opened, so no appUrlOpen callback will ever fire to end this attempt.
      endOAuthAttempt();
      setGoogleLoading(false);
    }
  };

  const handleTelegramLogin = async () => {
    setTelegramLoading(true);
    setError(null);
    beginOAuthAttempt();
    try {
      // Open the hosted Telegram widget page.  After the user signs in via the
      // Telegram Login Widget the server exchanges the data, creates an exchange
      // code, and redirects to zobia://auth/callback?code=... which is caught
      // by the appUrlOpen listener in __root.tsx.
      await Browser.open({
        url: `${env.VITE_API_BASE_URL}/auth/telegram-mobile?redirect=${encodeURIComponent(CALLBACK_DEEP_LINK)}`,
        presentationStyle: 'popover',
      });
    } catch (err) {
      console.error('[auth] Browser.open (Telegram) failed:', err);
      setError(t('auth.error.oauthFailed'));
      endOAuthAttempt();
      setTelegramLoading(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-6 py-12 bg-white">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-neutral-900">{t('app.name')}</h1>
          <p className="text-neutral-500 mt-1">{t('auth.signInTagline')}</p>
        </div>

        {reason === 'session_expired' && (
          <div className="bg-amber-50 text-amber-800 px-4 py-3 rounded-lg text-sm mb-4">
            {t('auth.sessionExpired.banner', 'Your session has expired. Please sign in again.')}
          </div>
        )}

        {error && (
          <div className="bg-danger-50 text-danger-700 px-4 py-3 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={googleLoading || telegramLoading}
            className="w-full flex items-center justify-center gap-3 py-3 border border-neutral-300 rounded-lg bg-white text-neutral-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {googleLoading ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-primary-600" />
            ) : (
              <GoogleIcon />
            )}
            {googleLoading ? t('action.loading') : t('auth.continueWithGoogle')}
          </button>

          <button
            type="button"
            onClick={handleTelegramLogin}
            disabled={googleLoading || telegramLoading}
            className="w-full flex items-center justify-center gap-3 py-3 border border-neutral-300 rounded-lg bg-white text-neutral-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {telegramLoading ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-primary-600" />
            ) : (
              <TelegramIcon />
            )}
            {telegramLoading ? t('action.loading') : t('auth.telegram_login')}
          </button>
        </div>

        <p className="text-center text-xs text-neutral-400 mt-6">
          By continuing you agree to our{' '}
          <a href={`${env.VITE_API_BASE_URL}/terms`} className="text-primary-600 underline">
            Terms of Service
          </a>{' '}
          and{' '}
          <a href={`${env.VITE_API_BASE_URL}/privacy`} className="text-primary-600 underline">
            Privacy Policy
          </a>
          .
        </p>

        <p className="text-center text-sm text-neutral-500 mt-4">
          {t('auth.noAccount')}{' '}
          <Link to="/auth/register" className="text-primary-600 font-medium">
            {t('auth.signUp')}
          </Link>
        </p>

        {/* BUG-CAP-07: link to the account-restore flow (for a deleted
            account) — mirrors the existing plain <a> pattern used for
            Terms/Privacy above; the page itself already exists on web
            (app/auth/restore/page.tsx) but nothing linked to it on any
            platform. */}
        <p className="text-center text-xs text-neutral-400 mt-2">
          <a href={`${env.VITE_API_BASE_URL}/auth/restore`} className="text-primary-600 underline">
            {t('auth.restoreAccount', 'Deleted your account? Restore it')}
          </a>
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/auth/login')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { reason?: string; redirect?: string } => ({
    reason: typeof search.reason === 'string' ? search.reason : undefined,
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  component: LoginPage,
});

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z" fill="#2CA5E0" />
    </svg>
  );
}
