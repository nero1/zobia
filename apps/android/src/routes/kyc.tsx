/**
 * apps/android/src/routes/kyc.tsx
 *
 * Identity verification (KYC) — thin wrapper, not a native reimplementation.
 * Per ZobiaSocial-PRD.md §22.0.1 and docs/HOW-IT-WORKS.md's Android section,
 * KYC document capture/liveness/AI review is explicitly web/PWA-only
 * territory (id capture, liveness video, bank-grade physical KYC). This
 * screen opens the real web KYC flow (apps/web/app/(app)/kyc/page.tsx) in a
 * Custom Tab via @capacitor/browser — the same in-app-browser pattern used
 * for OAuth (routes/auth/login.tsx) and the ads/business KYC entry points
 * (routes/ads/index.tsx), rather than an embedded iframe/webview.
 */

import { useEffect } from 'react';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { openAuthenticatedWebLink } from '@/lib/deeplinks/bridge';

function KycPage() {
  const { t } = useTranslation();
  const router = useRouter();

  useEffect(() => {
    void openAuthenticatedWebLink('/kyc');
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-neutral-50 px-6 text-center">
      <span className="text-4xl">🪪</span>
      <h1 className="text-lg font-bold text-neutral-900">{t('kyc.title')}</h1>
      <p className="text-sm text-neutral-500">
        {t('kyc.androidWrapperDesc', 'Identity verification opens in a secure browser tab.')}
      </p>
      <button
        onClick={() => void openAuthenticatedWebLink('/kyc')}
        className="rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white"
      >
        {t('kyc.startTier')}
      </button>
      <button onClick={() => router.history.back()} className="text-sm text-neutral-500">
        {t('action.back')}
      </button>
    </div>
  );
}

export const Route = createFileRoute('/kyc')({
  component: KycPage,
});
