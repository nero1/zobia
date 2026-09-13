/**
 * apps/android/src/components/admin/ImpersonationBanner.tsx
 *
 * Native equivalent of apps/web/components/admin/ImpersonationBanner.tsx.
 *
 * BACKEND GAP: POST /api/admin/users/:userId/impersonate (see
 * apps/web/app/api/admin/users/[userId]/impersonate/route.ts) swaps the
 * caller's session by setting cookies (accessCookie/refreshCookie plus a
 * non-HttpOnly `zobia_impersonating` marker) — it never returns the
 * impersonated session's tokens in the JSON body. Android's apiClient is a
 * bearer-JWT client with no shared cookie jar with the web app, so this
 * endpoint cannot hand the native app a real impersonated session today.
 *
 * Until the endpoint is extended to also return { accessToken, refreshToken }
 * in its JSON body for non-browser callers, Android surfaces impersonation
 * by bridging into an authenticated in-app browser tab (see users.tsx's
 * "Impersonate" button, using the same lib/deeplinks/bridge.ts helper as the
 * KYC/profile links) — the real web ImpersonationBanner then renders there,
 * cookie-backed, exactly as it does for a web admin.
 *
 * This component still exists and is mounted in AdminShell so that if a
 * future native session ever carries an `impersonated_by` claim (e.g. once
 * the backend gap above is closed), the banner activates automatically with
 * no further wiring — today `user.impersonated_by` is never set by the
 * mobile login/refresh flow, so it renders nothing.
 */

import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/store';

export function ImpersonationBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth() as { user: (Record<string, unknown> & { impersonated_by?: string | null }) | null };
  const [ending, setEnding] = useState(false);

  if (!user?.impersonated_by) return null;

  const endImpersonation = async () => {
    setEnding(true);
    try {
      await apiClient.post('/auth/impersonate/end');
      navigate({ to: '/admin/users' });
    } catch {
      setEnding(false);
    }
  };

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[70] flex items-center justify-center gap-3 bg-purple-700 px-4 py-2.5 text-center text-xs font-medium text-white shadow-modal"
      style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))' }}
    >
      <span>🎭 {t('admin.impersonation.banner', 'Viewing Zobia as this user')}</span>
      <button
        type="button"
        onClick={() => void endImpersonation()}
        disabled={ending}
        className="shrink-0 rounded-lg bg-white/20 px-3 py-1 text-xs font-semibold disabled:opacity-60"
      >
        {ending ? t('admin.impersonation.returning', 'Returning…') : t('admin.impersonation.returnToAdmin', 'Return to Admin')}
      </button>
    </div>
  );
}
