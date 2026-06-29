/**
 * apps/android/src/routes/auth/login.tsx
 *
 * Login screen. Validates with LoginRequestSchema from @zobia/shared/schemas/auth.
 * Stores token + user in auth store on success.
 */

import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Browser } from '@capacitor/browser';
import { LoginRequestSchema } from '@zobia/shared/schemas/auth';
import { useAuth } from '@/lib/auth/store';
import { apiClient } from '@/lib/api/client';
import { env } from '@/lib/env';
import type { AuthResponse } from '@zobia/shared/schemas/auth';

function LoginPage() {
  const { t } = useTranslation();
  const { setAuth } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      await Browser.open({
        url: `${env.VITE_API_BASE_URL}/api/auth/google?mobile=true`,
        presentationStyle: 'popover',
      });
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validation = LoginRequestSchema.safeParse({ email, password });
    if (!validation.success) {
      setError(validation.error.errors[0]?.message ?? t('error.generic'));
      return;
    }

    setLoading(true);
    try {
      const { data } = await apiClient.post<AuthResponse>('/auth/login', { email, password });
      if (data.accessToken) {
        await setAuth(data.accessToken, data.user);
        navigate({ to: '/home', replace: true });
      } else {
        setError(t('auth.error.unexpected'));
      }
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message;
      setError(msg ?? t('auth.error.unexpected'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-6 py-12 bg-white">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-neutral-900">{t('app.name')}</h1>
          <p className="text-neutral-500 mt-1">{t('auth.signInTagline')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-danger-50 text-danger-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              {t('auth.email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('android.auth.emailPlaceholder')}
              className="w-full px-4 py-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-neutral-900"
              autoComplete="email"
              data-selectable
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              {t('auth.password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('android.auth.passwordPlaceholder')}
              className="w-full px-4 py-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-neutral-900"
              autoComplete="current-password"
              data-selectable
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-primary-600 text-white font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? t('action.loading') : t('android.auth.loginButton')}
          </button>
        </form>

        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-neutral-200" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-3 text-neutral-400">{t('auth.orContinueWith')}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            className="mt-4 w-full flex items-center justify-center gap-3 py-3 border border-neutral-300 rounded-lg bg-white text-neutral-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            {googleLoading ? t('action.loading') : t('auth.continueWithGoogle')}
          </button>
        </div>

        <p className="text-center text-sm text-neutral-500 mt-6">
          <Link to="/auth/register" className="text-primary-600 font-medium">
            {t('android.auth.noAccount')}
          </Link>
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/auth/login')({
  component: LoginPage,
});
