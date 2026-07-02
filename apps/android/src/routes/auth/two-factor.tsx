import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth/store';
import { apiClient } from '@/lib/api/client';
import { getPreAuthToken, setPreAuthToken } from '@/lib/auth/preAuth';
import type { AuthResponse } from '@zobia/shared/schemas/auth';

function TwoFactorPage() {
  const { t } = useTranslation();
  const { setAuth } = useAuth();
  const navigate = useNavigate();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const preAuthToken = getPreAuthToken();
    if (!preAuthToken) {
      navigate({ to: '/auth/login', replace: true });
      return;
    }

    setLoading(true);
    try {
      // Without ?platform=mobile the API takes the web branch (sets HttpOnly
      // cookies, body has no accessToken/user) — this app can't use cookies,
      // so every code, even a correct one, looked like "invalid code" because
      // data.accessToken/data.user were always undefined below.
      const { data } = await apiClient.post<AuthResponse>('/auth/2fa/verify?platform=mobile', {
        preAuthToken,
        code,
      });
      if (data.accessToken && data.user) {
        setPreAuthToken(null);
        await setAuth(data.accessToken, data.user);
        navigate({ to: '/home', replace: true });
      } else {
        setError(t('auth.2fa.invalid_code'));
      }
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message;
      setError(msg ?? t('auth.2fa.invalid_code'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-6 py-12 bg-white">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-neutral-900">{t('auth.2fa.title')}</h1>
          <p className="text-neutral-500 mt-1">{t('auth.2fa.prompt')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-danger-50 text-danger-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="w-full px-4 py-3 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-neutral-900 text-center text-2xl tracking-widest"
              autoComplete="one-time-code"
              data-selectable
            />
          </div>

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full py-3 bg-primary-600 text-white font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? t('action.loading') : t('auth.2fa.verify')}
          </button>
        </form>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/auth/two-factor')({
  component: TwoFactorPage,
});
