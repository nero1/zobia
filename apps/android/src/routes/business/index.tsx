/**
 * apps/android/src/routes/business/index.tsx
 *
 * Business hub — mirrors apps/web/app/(app)/business/page.tsx. Signup and
 * tier changes go through Google Play Billing (PRD §18) — the only in-app
 * purchase mechanism allowed on Android — via lib/payments/googlePlay.ts,
 * never Paystack/DodoPayments checkout links (web/PWA-only).
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { BUSINESS_TIER_PRODUCTS, purchaseBusinessTier } from '@/lib/payments/googlePlay';

interface BusinessAccount {
  id: string;
  business_name: string;
  tier: 'starter' | 'growth' | 'enterprise';
  verified: boolean;
  status: string;
  downgrade_to_tier: string | null;
  downgrade_effective_at: string | null;
}

async function fetchBusiness(): Promise<BusinessAccount | null> {
  try {
    const { data } = await apiClient.get<{ business: BusinessAccount }>('/business');
    return data.business;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return null;
    throw err;
  }
}

function BusinessPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: account, status } = useQuery({ queryKey: ['business', 'me'], queryFn: fetchBusiness, staleTime: 60_000 });
  const [businessName, setBusinessName] = useState('');
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePurchase(productId: string) {
    setError(null);
    if (!account && !businessName.trim()) {
      setError(t('business.intro.nameRequired', 'Enter a business name to continue.'));
      return;
    }
    setPurchasingId(productId);
    try {
      const result = await purchaseBusinessTier(productId, businessName.trim() || undefined);
      if (result.success) {
        qc.invalidateQueries({ queryKey: ['business', 'me'] });
      } else {
        setError(result.error ?? t('error.generic'));
      }
    } finally {
      setPurchasingId(null);
    }
  }

  if (status === 'pending') {
    return <div className="p-6 text-center text-neutral-400">{t('common.loading', 'Loading…')}</div>;
  }

  if (!account) {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-6">
        <h1 className="text-lg font-bold text-neutral-900 mb-2">{t('business.intro.title', 'Grow your brand on Zobia')}</h1>
        <p className="text-sm text-neutral-500 mb-4">
          {t('business.intro.subtitle', 'Business Accounts unlock a verified badge, broadcast tools, Business Pages you can post to, a Quest Marketplace, and analytics that grow with your plan.')}
        </p>

        <input
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder={t('business.intro.namePlaceholder', 'Business name')}
          className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm text-neutral-900 mb-3 focus:border-primary-500 focus:outline-none"
        />

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="space-y-2">
          {BUSINESS_TIER_PRODUCTS.map((tier) => (
            <div key={tier.id} className="bg-white rounded-xl p-3 shadow-card flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-sm text-neutral-900">{tier.label}</p>
                <p className="text-xs text-neutral-500">{tier.price}</p>
              </div>
              <button
                onClick={() => handlePurchase(tier.id)}
                disabled={purchasingId !== null}
                className="shrink-0 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {purchasingId === tier.id ? t('common.loading', 'Loading…') : t('business.createButton', 'Create Business Account')}
              </button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-neutral-400 text-center">{t('business.intro.playBilling', 'Payment is handled securely by Google Play.')}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-6">
      <h1 className="text-lg font-bold text-neutral-900">{account.business_name}</h1>
      <div className="mt-1 flex flex-wrap gap-2">
        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-blue-700">{account.tier} tier</span>
        {account.verified && <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-semibold text-teal-700">Verified ✓</span>}
      </div>

      {account.downgrade_to_tier && account.downgrade_effective_at && (
        <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          Downgrading to {account.downgrade_to_tier} on {new Date(account.downgrade_effective_at).toLocaleDateString()}.
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 space-y-2">
        <Link to="/business/pages" className="block bg-white rounded-xl p-4 shadow-card">
          <p className="font-semibold text-sm text-neutral-900">🏢 Business Pages</p>
          <p className="text-xs text-neutral-500 mt-0.5">Create and manage pages, post updates.</p>
        </Link>
        <Link to="/business/ads" className="block bg-white rounded-xl p-4 shadow-card">
          <p className="font-semibold text-sm text-neutral-900">📣 Advertising Panel</p>
          <p className="text-xs text-neutral-500 mt-0.5">Submit and track Sponsored Quests.</p>
        </Link>
      </div>

      <div className="mt-4 bg-white rounded-xl p-4 shadow-card">
        <p className="font-semibold text-sm text-neutral-900 mb-2">{t('business.tier.changeTitle', 'Change tier')}</p>
        <div className="space-y-2">
          {BUSINESS_TIER_PRODUCTS.filter((tier) => tier.tier !== account.tier).map((tier) => (
            <div key={tier.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-900">{tier.label}</p>
                <p className="text-xs text-neutral-500">{tier.price}</p>
              </div>
              <button
                onClick={() => handlePurchase(tier.id)}
                disabled={purchasingId !== null}
                className="shrink-0 rounded-lg border border-primary-600 px-3 py-1.5 text-xs font-semibold text-primary-600 disabled:opacity-60"
              >
                {purchasingId === tier.id ? t('common.loading', 'Loading…') : t('business.tier.switch', 'Switch')}
              </button>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 text-xs text-neutral-400 text-center">
        Manage verification and full analytics on web/PWA under Settings → Business.
      </p>
    </div>
  );
}

export const Route = createFileRoute('/business/')({
  component: BusinessPage,
});
