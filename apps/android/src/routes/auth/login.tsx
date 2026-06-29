/**
 * apps/android/src/routes/auth/login.tsx
 *
 * Login screen. Validates with LoginRequestSchema from @zobia/shared/schemas/auth.
 * Stores token + user in auth store on success.
 */

import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LoginRequestSchema } from '@zobia/shared/schemas/auth';
import { useAuth } from '@/lib/auth/store';
import { apiClient } from '@/lib/api/client';
import type { AuthResponse } from '@zobia/shared/schemas/auth';

function LoginPage() {
  const { t } = useTranslation();
  const { setAuth } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
