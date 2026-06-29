/**
 * apps/android/src/routes/auth/register.tsx
 *
 * Register screen — OAuth only (mirrors web canonical).
 * Sign-up uses the same OAuth providers as login; the server creates a new
 * account automatically on first OAuth login.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Browser } from '@capacitor/browser';
import { env } from '@/lib/env';

const CALLBACK_DEEP_LINK = 'zobia://auth/callback';

function RegisterPage() {
  const { t } = useTranslation();

  const [googleLoading, setGoogleLoading] = useState(false);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignUp = async () => {
    setGoogleLoading(true);
    setError(null);
    try {
      await Browser.open({
        url: `${env.VITE_API_BASE_URL}/api/auth/google?redirect=${encodeURIComponent(CALLBACK_DEEP_LINK)}`,
        presentationStyle: 'popover',
      });
    } catch (err) {
      console.error('[auth] Browser.open (Google) failed:', err);
      setError(t('auth.error.oauthFailed'));
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleTelegramSignUp = async () => {
    setTelegramLoading(true);
    setError(null);
    try {
      await Browser.open({
        url: `${env.VITE_API_BASE_URL}/auth/telegram-mobile?redirect=${encodeURIComponent(CALLBACK_DEEP_LINK)}`,
        presentationStyle: 'popover',
      });
    } catch (err) {
      console.error('[auth] Browser.open (Telegram) failed:', err);
      setError(t('auth.error.oauthFailed'));
    } finally {
      setTelegramLoading(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-6 py-12 bg-white">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-neutral-900">{t('app.name')}</h1>
          <p className="text-neutral-500 mt-1">{t('auth.registerTagline')}</p>
        </div>

        {error && (
          <div className="bg-danger-50 text-danger-700 px-4 py-3 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleGoogleSignUp}
            disabled={googleLoading || telegramLoading}
            className="w-full flex items-center justify-center gap-3 py-3 border border-neutral-300 rounded-lg bg-white text-neutral-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {googleLoading ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-primary-600" />
            ) : (
              <GoogleIcon />
            )}
            {googleLoading ? t('action.loading') : t('auth.signUpWithGoogle')}
          </button>

          <button
            type="button"
            onClick={handleTelegramSignUp}
            disabled={googleLoading || telegramLoading}
            className="w-full flex items-center justify-center gap-3 py-3 border border-neutral-300 rounded-lg bg-white text-neutral-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {telegramLoading ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-primary-600" />
            ) : (
              <TelegramIcon />
            )}
            {telegramLoading ? t('action.loading') : t('auth.signingUpWithTelegram')}
          </button>
        </div>

        <p className="text-center text-xs text-neutral-400 mt-6">
          By signing up you agree to our{' '}
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
          {t('auth.haveAccount')}{' '}
          <Link to="/auth/login" className="text-primary-600 font-medium">
            {t('auth.login')}
          </Link>
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/auth/register')({
  component: RegisterPage,
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
