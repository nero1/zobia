/**
 * apps/android/src/routes/ads/index.tsx
 *
 * Ads hub — mirrors apps/web/app/(app)/ads/page.tsx. Eligible advertisers
 * (verified Business Account, KYC Tier 1+) are sent to the full
 * Advertising Panel at /business/ads; everyone else sees the explainer.
 */

import { useEffect } from 'react';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { openAuthenticatedWebLink } from '@/lib/deeplinks/bridge';
import { useFeatureFlags } from '@/lib/hooks/useManifest';

interface Eligibility {
  eligible: boolean;
  reason?: string;
}

async function fetchEligibility(): Promise<Eligibility> {
  const { data } = await apiClient.get<Eligibility>('/business/ads/eligibility');
  return data;
}

// ZSB-18 fix: this whole file (and its siblings — business/ads/index.tsx,
// business/pages/index.tsx, business/pages/$pageId.tsx) had no
// useTranslation/t() usage at all, unlike the rest of the app. Feature copy
// keys added under `ads.features.*`; everything else reuses the `ads.*`/
// `action.*` keys already established by the web app's Advertising Panel.
const FEATURES = [
  { emoji: '🖼️', titleKey: 'ads.features.formats.title', bodyKey: 'ads.features.formats.body' },
  { emoji: '💰', titleKey: 'ads.features.cpm.title', bodyKey: 'ads.features.cpm.body' },
  { emoji: '🤖', titleKey: 'ads.features.review.title', bodyKey: 'ads.features.review.body' },
  { emoji: '📈', titleKey: 'ads.features.boost.title', bodyKey: 'ads.features.boost.body' },
] as const;

function AdsHubPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const featureFlags = useFeatureFlags();
  const kycEnabled = featureFlags?.kyc !== false;
  const { data, status } = useQuery({ queryKey: ['ads', 'eligibility'], queryFn: fetchEligibility });

  useEffect(() => {
    if (data?.eligible) router.navigate({ to: '/business/ads' });
  }, [data, router]);

  if (status === 'pending' || data?.eligible) {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
        <div className="h-40 animate-pulse rounded-2xl bg-neutral-200" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <h1 className="text-lg font-bold text-neutral-900 mb-1">{t('ads.hubTitle', 'Advertise on Zobia')}</h1>
      <p className="text-sm text-neutral-500 mb-4">{t('ads.hubSubtitle', 'Reach the Zobia community with banners, native placements, interstitials, and rewarded video — billed by CPM.')}</p>

      <div className="bg-white rounded-xl p-4 shadow-card mb-4">
        <p className="text-sm text-neutral-600">{data?.reason ?? t('ads.eligibilityDefault', 'You need a verified Business Account with identity verification to place ads.')}</p>
        <div className="mt-3 flex gap-2">
          <Link to="/business" className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white">{t('ads.createBusinessAccount', 'Create a Business Account')}</Link>
          {kycEnabled && (
            <button
              onClick={() => void openAuthenticatedWebLink('/kyc')}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700"
            >
              {t('ads.completeKyc', 'Complete identity verification')}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {FEATURES.map((f) => (
          <div key={f.titleKey} className="bg-white rounded-xl p-3 shadow-card">
            <span className="text-xl">{f.emoji}</span>
            <p className="mt-1 text-xs font-semibold text-neutral-900">{t(f.titleKey)}</p>
            <p className="mt-0.5 text-[11px] text-neutral-500">{t(f.bodyKey)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/ads/')({
  component: AdsHubPage,
});
