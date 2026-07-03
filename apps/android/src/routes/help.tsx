/**
 * apps/android/src/routes/help.tsx
 *
 * Help / FAQ — BUG-CAP-07 fix: Android had no help section at all, unlike
 * web's app/help/page.tsx. Opens that same page in an in-app browser tab
 * rather than re-implementing the help content natively — same
 * Browser.open() pattern already used for OAuth login and the Terms/Privacy
 * links in routes/auth/login.tsx. A native in-app help screen can replace
 * this later if product wants richer in-app UX, but this gives every user a
 * working path to help content today with no backend changes.
 */

import { useEffect } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Browser } from '@capacitor/browser';
import { env } from '@/lib/env';

function HelpPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    Browser.open({ url: `${env.VITE_WEB_BASE_URL.replace(/\/$/, '')}/help`, presentationStyle: 'popover' })
      .catch((err) => console.error('[help] Browser.open failed:', err))
      .finally(() => navigate({ to: '/settings', replace: true }));
  }, [navigate]);

  return (
    <div className="flex h-full items-center justify-center bg-neutral-50">
      <p className="text-sm text-neutral-500">{t('help.opening', 'Opening help…')}</p>
    </div>
  );
}

export const Route = createFileRoute('/help')({
  component: HelpPage,
});
