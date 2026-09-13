/**
 * apps/android/src/components/admin/ImpersonationBanner.tsx
 *
 * Mirrors apps/web/components/admin/ImpersonationBanner.tsx: a fixed bottom
 * bar shown whenever this app's own session is an admin impersonating
 * another user, with a button to end it and restore the admin's session.
 *
 * Unlike web (which detects impersonation by reading a non-HttpOnly cookie),
 * this app has no cookies at all — Bearer-JWT sessions carry the marker as
 * `impersonatedBy` in the auth store (see lib/auth/store.ts), set by
 * `impersonate()` and cleared by `endImpersonation()`.
 *
 * Ending impersonation swaps the app's own stored tokens back to the
 * admin's — natively, no browser tab — then this navigates back into the
 * admin section.
 */

import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth/store';

export function ImpersonationBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { impersonatedBy, endImpersonation } = useAuth();
  const [ending, setEnding] = useState(false);

  if (!impersonatedBy) return null;

  const handleEnd = async () => {
    setEnding(true);
    try {
      await endImpersonation();
      navigate({ to: '/admin/users', replace: true });
    } catch {
      // Leave the banner up so the admin can retry.
    } finally {
      setEnding(false);
    }
  };

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[9999] flex items-center justify-center gap-3 bg-purple-700 px-4 py-2.5 text-xs font-medium text-white shadow-lg"
      style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom))' }}
    >
      <span>🎭 {t('admin.impersonation.banner', 'Viewing as this user (impersonation).')}</span>
      <button
        type="button"
        onClick={handleEnd}
        disabled={ending}
        className="shrink-0 rounded-lg bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30 disabled:opacity-60"
      >
        {ending ? t('admin.impersonation.returning', 'Returning…') : t('admin.impersonation.returnToAdmin', 'Return to Admin')}
      </button>
    </div>
  );
}
